import { v4 as uuidv4 } from 'uuid'
import type { S3Client } from '@aws-sdk/client-s3'
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  uploadPart,
} from '../lib/r2.js'
import {
  appendLocal,
  deleteLocal,
  getLocalAbsolutePath,
  preferR2Url,
  putBoth,
  putLocal,
  renameLocal,
} from '../lib/storage.js'
import { extractVideoPoster } from '../lib/video-poster.js'
import { prisma } from '../lib/prisma.js'
import { HttpError, type MediaItem } from '../types/media.js'
import {
  MEDIA_PREFIX,
  MAX_VIDEO_SIZE_BYTES,
  MAX_VIDEO_SIZE_MB,
  extensionFromNameOrMime,
  mediaTypeFromMime,
  toMediaItem,
} from './media.service.js'

const SESSION_TTL_MS = 2 * 60 * 60 * 1000

type UploadSession = {
  mediaId: string
  uploadId: string | null
  key: string
  tempKey: string
  contentType: string
  guest: string
  size: number
  r2Ok: boolean
  localOk: boolean
  parts: Map<number, string>
  createdAt: number
  bytesReceived: number
}

const sessions = new Map<string, UploadSession>()

function cleanupExpiredSessions() {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id)
      void deleteLocal(session.tempKey)
    }
  }
}

setInterval(cleanupExpiredSessions, 15 * 60 * 1000).unref?.()

export async function initVideoUpload(
  client: S3Client | null,
  {
    guest,
    fileName,
    contentType,
    size,
  }: {
    guest?: string
    fileName?: string
    contentType?: string
    size?: number
  },
): Promise<{ uploadId: string; mediaId: string; key: string }> {
  cleanupExpiredSessions()

  if (!contentType || mediaTypeFromMime(contentType) !== 'video') {
    throw new HttpError(400, 'Arquivo deve ser um vídeo.')
  }
  if (!size || size <= 0) {
    throw new HttpError(400, 'Tamanho do vídeo inválido.')
  }
  if (size > MAX_VIDEO_SIZE_BYTES) {
    throw new HttpError(
      400,
      `Vídeo excede o limite de ${MAX_VIDEO_SIZE_MB}MB.`,
    )
  }

  const mediaId = uuidv4()
  const ext = extensionFromNameOrMime(fileName, contentType) || '.mp4'
  const key = `${MEDIA_PREFIX}/${mediaId}${ext}`
  const tempKey = `${MEDIA_PREFIX}/tmp/${mediaId}${ext}`
  const guestName = guest?.trim() || 'Convidado(a)'

  let uploadId: string | null = null
  let r2Ok = false

  if (client) {
    try {
      uploadId = await createMultipartUpload(client, { key, contentType })
      r2Ok = true
    } catch (err) {
      console.warn(
        '[video/init] R2 multipart create failed:',
        err instanceof Error ? err.message : err,
      )
    }
  }

  // Ensure local temp file exists (empty) so appends work
  let localOk = false
  try {
    await putLocal(tempKey, Buffer.alloc(0))
    localOk = true
  } catch (err) {
    console.warn(
      '[video/init] local temp create failed:',
      err instanceof Error ? err.message : err,
    )
  }

  if (!r2Ok && !localOk) {
    throw new HttpError(500, 'Não foi possível iniciar o upload do vídeo.')
  }

  const sessionUploadId = uploadId || `local-only:${mediaId}`

  sessions.set(mediaId, {
    mediaId,
    uploadId,
    key,
    tempKey,
    contentType,
    guest: guestName,
    size,
    r2Ok,
    localOk,
    parts: new Map(),
    createdAt: Date.now(),
    bytesReceived: 0,
  })

  return { uploadId: sessionUploadId, mediaId, key }
}

export async function uploadVideoChunk(
  client: S3Client | null,
  {
    mediaId,
    uploadId,
    partNumber,
    body,
  }: {
    mediaId: string
    uploadId: string
    partNumber: number
    body: Buffer
  },
): Promise<{ etag: string; partNumber: number }> {
  const session = sessions.get(mediaId)
  if (!session) {
    throw new HttpError(404, 'Sessão de upload não encontrada.')
  }
  if (
    session.uploadId &&
    uploadId !== session.uploadId &&
    uploadId !== `local-only:${mediaId}`
  ) {
    throw new HttpError(400, 'uploadId inválido.')
  }
  if (!Number.isInteger(partNumber) || partNumber < 1) {
    throw new HttpError(400, 'partNumber inválido.')
  }
  if (!body.length) {
    throw new HttpError(400, 'Chunk vazio.')
  }

  session.bytesReceived += body.length
  if (session.bytesReceived > session.size + 1024 * 1024) {
    throw new HttpError(400, 'Tamanho recebido excede o declarado.')
  }

  let etag = `local-part-${partNumber}`

  const tasks: Promise<void>[] = []

  if (session.r2Ok && session.uploadId && client) {
    tasks.push(
      uploadPart(client, {
        key: session.key,
        uploadId: session.uploadId,
        partNumber,
        body,
      })
        .then((tag) => {
          etag = tag
          session.parts.set(partNumber, tag)
        })
        .catch((err) => {
          session.r2Ok = false
          throw err
        }),
    )
  }

  if (session.localOk) {
    tasks.push(
      appendLocal(session.tempKey, body).catch((err) => {
        session.localOk = false
        throw err
      }),
    )
  }

  const results = await Promise.allSettled(tasks)
  const anyOk = results.some((r) => r.status === 'fulfilled')

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn(
        `[video/chunk] part ${partNumber} task ${i} failed:`,
        r.reason,
      )
    }
  })

  if (!anyOk) {
    throw new HttpError(500, `Falha ao salvar a parte ${partNumber}.`)
  }

  // If R2 failed but local worked, keep going with synthetic etag
  if (!session.parts.has(partNumber)) {
    session.parts.set(partNumber, etag)
  }

  return { etag: session.parts.get(partNumber)!, partNumber }
}

export async function completeVideoUpload(
  client: S3Client | null,
  {
    mediaId,
    uploadId,
    parts,
  }: {
    mediaId: string
    uploadId: string
    parts: { etag: string; partNumber: number }[]
  },
): Promise<MediaItem> {
  const session = sessions.get(mediaId)
  if (!session) {
    throw new HttpError(404, 'Sessão de upload não encontrada.')
  }

  let r2Ok = false
  let videoSrc = ''

  if (session.r2Ok && session.uploadId && client) {
    try {
      const sorted =
        parts.length > 0
          ? parts.map((p) => ({
              ETag: p.etag,
              PartNumber: p.partNumber,
            }))
          : [...session.parts.entries()].map(([PartNumber, ETag]) => ({
              ETag,
              PartNumber,
            }))

      videoSrc = await completeMultipartUpload(client, {
        key: session.key,
        uploadId: session.uploadId,
        parts: sorted,
      })
      r2Ok = true
    } catch (err) {
      console.warn(
        '[video/complete] R2 complete failed:',
        err instanceof Error ? err.message : err,
      )
      try {
        await abortMultipartUpload(client, {
          key: session.key,
          uploadId: session.uploadId,
        })
      } catch {
        /* ignore */
      }
    }
  } else if (session.uploadId && client) {
    try {
      await abortMultipartUpload(client, {
        key: session.key,
        uploadId: session.uploadId,
      })
    } catch {
      /* ignore */
    }
  }

  void videoSrc

  let localOk = session.localOk
  if (localOk) {
    try {
      if (session.tempKey !== session.key) {
        await renameLocal(session.tempKey, session.key)
      }
    } catch (err) {
      console.warn(
        '[video/complete] local finalize failed:',
        err instanceof Error ? err.message : err,
      )
      localOk = false
    }
  }

  if (!r2Ok && !localOk) {
    sessions.delete(mediaId)
    throw new HttpError(500, 'Falha ao finalizar o upload do vídeo.')
  }

  let posterKey: string | null = null
  let posterUrl: string | null = null
  let posterLocal = false

  try {
    if (localOk) {
      const posterBuf = await extractVideoPoster(
        getLocalAbsolutePath(session.key),
      )
      if (posterBuf) {
        posterKey = `${MEDIA_PREFIX}/${mediaId}-poster.webp`
        const posterResult = await putBoth(client, {
          key: posterKey,
          body: posterBuf,
          contentType: 'image/webp',
        })
        posterLocal = posterResult.localOk
        posterUrl = preferR2Url(
          posterKey,
          posterResult.r2Ok,
          mediaId,
          'poster',
        )
      }
    }
  } catch (err) {
    console.warn(
      '[video/complete] poster failed:',
      err instanceof Error ? err.message : err,
    )
  }

  const src = preferR2Url(session.key, r2Ok, mediaId, 'display')

  const row = await prisma.media.create({
    data: {
      id: mediaId,
      guest: session.guest,
      src,
      src_original: src,
      poster: posterUrl,
      type: 'video',
      r2_ok: r2Ok,
      local_ok: localOk || posterLocal,
      original_key: session.key,
      display_key: session.key,
      poster_key: posterKey,
    },
  })

  sessions.delete(mediaId)
  return toMediaItem(row as Parameters<typeof toMediaItem>[0])
}

export async function abortVideoUpload(
  client: S3Client | null,
  { mediaId, uploadId }: { mediaId: string; uploadId: string },
): Promise<void> {
  const session = sessions.get(mediaId)
  if (!session) return

  if (session.r2Ok && session.uploadId && client) {
    try {
      await abortMultipartUpload(client, {
        key: session.key,
        uploadId: session.uploadId,
      })
    } catch (err) {
      console.warn(
        '[video/abort] R2 abort failed:',
        err instanceof Error ? err.message : err,
      )
    }
  }

  await deleteLocal(session.tempKey)
  await deleteLocal(session.key)
  sessions.delete(mediaId)
  void uploadId
}
