import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type { S3Client } from '@aws-sdk/client-s3'
import { putObject } from '../lib/r2.js'
import { prisma } from '../lib/prisma.js'
import {
  HttpError,
  type MediaItem,
  type MediaKind,
  type UploadMediaResult,
} from '../types/media.js'

export const MEDIA_PREFIX = 'gallery/media'
export const MAX_SIZE_BYTES = 100 * 1024 * 1024
export const MAX_SIZE_MB = MAX_SIZE_BYTES / (1024 * 1024)

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

function extensionFromFile(file: Express.Multer.File): string {
  const fromName = path.extname(file.originalname || '').toLowerCase()
  if (fromName) return fromName
  return EXTENSION_BY_MIME[file.mimetype] || ''
}

function toMediaItem(row: {
  id: string
  type: MediaKind
  src: string
  guest: string
  created_at: Date
}): MediaItem {
  return {
    id: row.id,
    type: row.type,
    src: row.src,
    guest: row.guest,
    date: formatDatePtBr(row.created_at),
  }
}

export async function listMedia(): Promise<MediaItem[]> {
  const rows = await prisma.media.findMany({
    orderBy: { created_at: 'desc' },
  })

  return rows.map(toMediaItem)
}

async function uploadOne(
  client: S3Client,
  file: Express.Multer.File,
  guestName: string,
): Promise<MediaItem> {
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error(`excede o limite de ${MAX_SIZE_MB}MB`)
  }

  const type = mediaTypeFromMime(file.mimetype)
  if (!type) {
    throw new Error('não é uma imagem ou vídeo')
  }

  const id = uuidv4()
  const ext = extensionFromFile(file)
  const key = `${MEDIA_PREFIX}/${id}${ext}`
  const src = await putObject(client, {
    key,
    body: file.buffer,
    contentType: file.mimetype,
  })

  const row = await prisma.media.create({
    data: {
      id,
      guest: guestName,
      src,
      type,
    },
  })

  return toMediaItem(row)
}

export async function uploadMedia(
  client: S3Client,
  { files, guest }: { files?: Express.Multer.File[]; guest?: string },
): Promise<UploadMediaResult> {
  if (!files?.length) throw new HttpError(400, 'Nenhum arquivo enviado.')

  const guestName = guest?.trim() || 'Convidado(a)'
  const results = await Promise.allSettled(
    files.map((file) => uploadOne(client, file, guestName)),
  )

  const items: MediaItem[] = []
  const errors: UploadMediaResult['errors'] = []

  results.forEach((result, index) => {
    const fileName = files[index]?.originalname || `arquivo ${index + 1}`
    if (result.status === 'fulfilled') {
      items.push(result.value)
      return
    }

    const reason =
      result.reason instanceof Error
        ? result.reason.message
        : 'falha ao enviar'

    errors.push({ file: fileName, reason })
  })

  if (!items.length) {
    const summary = errors
      .map((e) => `"${e.file}": ${e.reason}`)
      .join('; ')
    throw new HttpError(400, `Nenhum arquivo foi enviado. ${summary}`)
  }

  return { items, errors }
}
