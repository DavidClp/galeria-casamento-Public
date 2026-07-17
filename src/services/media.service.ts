import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type { S3Client } from '@aws-sdk/client-s3'
import { optimizeImage } from '../lib/image.js'
import {
  localFileUrl,
  preferR2Url,
  putBoth,
  getLocalAbsolutePath,
  localFileExists,
} from '../lib/storage.js'
import { prisma } from '../lib/prisma.js'
import {
  HttpError,
  type MediaItem,
  type MediaKind,
  type UploadMediaResult,
} from '../types/media.js'

export const MEDIA_PREFIX = 'gallery/media'
export const MAX_IMAGE_SIZE_BYTES = 100 * 1024 * 1024
export const MAX_IMAGE_SIZE_MB = MAX_IMAGE_SIZE_BYTES / (1024 * 1024)
/** @deprecated use MAX_IMAGE_SIZE_MB */
export const MAX_SIZE_MB = MAX_IMAGE_SIZE_MB
export const MAX_VIDEO_SIZE_BYTES = 2 * 1024 * 1024 * 1024
export const MAX_VIDEO_SIZE_MB = 2048

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
])

const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
  'video/x-matroska',
])

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-msvideo': '.avi',
  'video/x-matroska': '.mkv',
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
}

export function mediaTypeFromMime(mime?: string): MediaKind | null {
  if (!mime) return null
  if (IMAGE_TYPES.has(mime) || mime.startsWith('image/')) return 'photo'
  if (VIDEO_TYPES.has(mime) || mime.startsWith('video/')) return 'video'
  return null
}

export function formatDatePtBr(date = new Date()): string {
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function extensionFromNameOrMime(
  fileName?: string,
  mime?: string,
): string {
  const fromName = path.extname(fileName || '').toLowerCase()
  if (fromName) return fromName
  return (mime && EXTENSION_BY_MIME[mime]) || ''
}

type MediaRow = {
  id: string
  type: MediaKind
  src: string
  src_original: string | null
  poster: string | null
  guest: string
  created_at: Date
  r2_ok: boolean
  local_ok: boolean
  original_key: string | null
  display_key: string | null
  poster_key: string | null
}

type PhotoDbRow = {
  id: string
  guest: string
  src: string
  src_original: string
  type: 'photo'
  r2_ok: boolean
  local_ok: boolean
  original_key: string
  display_key: string
}

function schedulePhotoPersist(rows: PhotoDbRow[]): void {
  if (!rows.length) return
  void prisma.media
    .createMany({ data: rows })
    .catch((err) => {
      console.error(
        '[upload] falha ao persistir fotos no banco:',
        rows.map((r) => r.id).join(', '),
        err,
      )
    })
}

export function toMediaItem(row: MediaRow): MediaItem {
  const displayKey = row.display_key || row.original_key
  const src =
    row.src ||
    preferR2Url(displayKey, row.r2_ok, row.id, 'display')
  const srcOriginal =
    row.src_original ||
    preferR2Url(
      row.original_key || displayKey,
      row.r2_ok,
      row.id,
      'original',
      row.src,
    )

  const item: MediaItem = {
    id: row.id,
    type: row.type,
    src,
    srcOriginal,
    guest: row.guest,
    date: formatDatePtBr(row.created_at),
  }

  if (row.local_ok) {
    item.srcFallback = localFileUrl(row.id, 'display')
    item.originalFallback = localFileUrl(row.id, 'original')
  }

  if (row.type === 'video') {
    item.poster =
      row.poster ||
      (row.poster_key
        ? preferR2Url(row.poster_key, row.r2_ok, row.id, 'poster')
        : null)
    if (row.local_ok && row.poster_key) {
      item.posterFallback = localFileUrl(row.id, 'poster')
    }
  }

  return item
}

export async function listMedia(): Promise<MediaItem[]> {
  const rows = await prisma.media.findMany({
    orderBy: { created_at: 'desc' },
  })
  return rows.map((row) => toMediaItem(row as MediaRow))
}

async function uploadPhoto(
  client: S3Client | null,
  file: Express.Multer.File,
  guestName: string,
): Promise<{ item: MediaItem; dbRow: PhotoDbRow }> {
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`excede o limite de ${MAX_IMAGE_SIZE_MB}MB`)
  }

  const id = uuidv4()
  const ext = extensionFromNameOrMime(file.originalname, file.mimetype)
  const originalKey = `${MEDIA_PREFIX}/${id}${ext}`
  const displayKey = `${MEDIA_PREFIX}/${id}.webp`

  const optimized = await optimizeImage(file.buffer, file.mimetype)

  const originalTask = putBoth(client, {
    key: originalKey,
    body: optimized.original,
    contentType: file.mimetype,
  })

  const displayTask = optimized.display
    ? putBoth(client, {
        key: displayKey,
        body: optimized.display,
        contentType: optimized.displayContentType,
      })
    : null

  const [originalSettled, displaySettled] = await Promise.allSettled([
    originalTask,
    displayTask ?? Promise.resolve(null),
  ])

  if (originalSettled.status === 'rejected') {
    throw originalSettled.reason instanceof Error
      ? originalSettled.reason
      : new Error('falha ao salvar original')
  }

  const originalResult = originalSettled.value
  let finalDisplayKey = originalKey
  let displayResult = originalResult

  if (displayTask && displaySettled.status === 'fulfilled' && displaySettled.value) {
    finalDisplayKey = displayKey
    displayResult = displaySettled.value
  } else if (displayTask && displaySettled.status === 'rejected') {
    console.warn(
      '[upload] display webp putBoth failed, using original:',
      displaySettled.reason instanceof Error
        ? displaySettled.reason.message
        : displaySettled.reason,
    )
  }

  const r2Ok = originalResult.r2Ok || displayResult.r2Ok
  const localOk = originalResult.localOk || displayResult.localOk
  const src = preferR2Url(finalDisplayKey, r2Ok, id, 'display')
  const srcOriginal = preferR2Url(originalKey, r2Ok, id, 'original')
  const createdAt = new Date()

  const dbRow: PhotoDbRow = {
    id,
    guest: guestName,
    src,
    src_original: srcOriginal,
    type: 'photo',
    r2_ok: r2Ok,
    local_ok: localOk,
    original_key: originalKey,
    display_key: finalDisplayKey,
  }

  return {
    item: toMediaItem({ ...dbRow, created_at: createdAt, poster: null, poster_key: null }),
    dbRow,
  }
}

export async function uploadMedia(
  client: S3Client | null,
  { files, guest }: { files?: Express.Multer.File[]; guest?: string },
): Promise<UploadMediaResult> {
  if (!files?.length) throw new HttpError(400, 'Nenhum arquivo enviado.')

  const guestName = guest?.trim() || 'Convidado(a)'
  const items: MediaItem[] = []
  const errors: UploadMediaResult['errors'] = []

  const photoJobs: { file: Express.Multer.File; fileName: string }[] = []

  for (const [index, file] of files.entries()) {
    const fileName = file.originalname || `arquivo ${index + 1}`
    const type = mediaTypeFromMime(file.mimetype)

    if (type === 'video') {
      errors.push({
        file: fileName,
        reason: 'vídeos devem ser enviados via upload em partes',
      })
      continue
    }

    if (type !== 'photo') {
      errors.push({ file: fileName, reason: 'não é uma imagem' })
      continue
    }

    photoJobs.push({ file, fileName })
  }

  const results = await Promise.allSettled(
    photoJobs.map(({ file }) => uploadPhoto(client, file, guestName)),
  )

  const dbRows: PhotoDbRow[] = []

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      items.push(result.value.item)
      dbRows.push(result.value.dbRow)
      return
    }
    errors.push({
      file: photoJobs[index].fileName,
      reason:
        result.reason instanceof Error
          ? result.reason.message
          : 'falha ao enviar',
    })
  })

  schedulePhotoPersist(dbRows)

  if (!items.length) {
    const summary = errors.map((e) => `"${e.file}": ${e.reason}`).join('; ')
    throw new HttpError(400, `Nenhum arquivo foi enviado. ${summary}`)
  }

  return { items, errors }
}

export type FileVariant = 'display' | 'original' | 'poster'

export async function resolveLocalFile(
  id: string,
  variant: FileVariant,
): Promise<{ absolutePath: string; contentType: string } | null> {
  const row = await prisma.media.findUnique({ where: { id } })
  if (!row || !row.local_ok) return null

  let key: string | null = null
  if (variant === 'poster') key = row.poster_key
  else if (variant === 'original') key = row.original_key || row.display_key
  else key = row.display_key || row.original_key

  if (!key) return null
  if (!(await localFileExists(key))) return null

  const ext = path.extname(key).toLowerCase()
  const contentType = CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream'
  return { absolutePath: getLocalAbsolutePath(key), contentType }
}
