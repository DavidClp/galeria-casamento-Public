import { Router, raw } from 'express'
import type { S3Client } from '@aws-sdk/client-s3'
import { createR2Client } from '../lib/r2.js'
import { upload } from '../middleware/upload.js'
import {
  listMedia,
  resolveLocalFile,
  uploadMedia,
  type FileVariant,
} from '../services/media.service.js'
import {
  abortVideoUpload,
  completeVideoUpload,
  initVideoUpload,
  uploadVideoChunk,
} from '../services/video-upload.service.js'
import { HttpError } from '../types/media.js'

export const mediaRouter = Router()

let r2: S3Client | null = null

function getR2Client(): S3Client | null {
  if (!r2) {
    try {
      r2 = createR2Client()
    } catch {
      return null
    }
  }
  return r2
}

try {
  r2 = createR2Client()
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.warn(`[startup] R2 client not ready: ${message}`)
  console.warn('[startup] Fill .env from .env.example before uploading.')
}

function handleHttpError(res: import('express').Response, err: unknown, fallback: string) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  res.status(500).json({ error: fallback })
}

mediaRouter.get('/', async (_req, res) => {
  try {
    const items = await listMedia()
    res.json({ items })
  } catch (err) {
    console.error('[GET /api/media]', err)
    res.status(500).json({ error: 'Falha ao listar mídia.' })
  }
})

mediaRouter.post('/', upload.array('files'), async (req, res) => {
  try {
    const guest =
      typeof req.body?.guest === 'string' ? req.body.guest : undefined

    const { items, errors } = await uploadMedia(getR2Client(), {
      files: req.files as Express.Multer.File[] | undefined,
      guest,
    })
    res.status(201).json({ items, errors })
  } catch (err) {
    console.error('[POST /api/media]', err)
    handleHttpError(res, err, 'Falha ao enviar mídia.')
  }
})

mediaRouter.post('/video/init', async (req, res) => {
  try {
    const result = await initVideoUpload(getR2Client(), {
      guest: typeof req.body?.guest === 'string' ? req.body.guest : undefined,
      fileName:
        typeof req.body?.fileName === 'string' ? req.body.fileName : undefined,
      contentType:
        typeof req.body?.contentType === 'string'
          ? req.body.contentType
          : undefined,
      size:
        typeof req.body?.size === 'number'
          ? req.body.size
          : Number(req.body?.size),
    })
    res.status(201).json(result)
  } catch (err) {
    console.error('[POST /api/media/video/init]', err)
    handleHttpError(res, err, 'Falha ao iniciar upload de vídeo.')
  }
})

const chunkParser = raw({
  type: '*/*',
  limit: '25mb',
})

mediaRouter.put('/video/chunk', chunkParser, async (req, res) => {
  try {
    const mediaId = String(req.headers['x-media-id'] || '')
    const uploadId = String(req.headers['x-upload-id'] || '')
    const partNumber = Number(req.headers['x-part-number'])

    if (!mediaId || !uploadId || !partNumber) {
      res.status(400).json({
        error:
          'Headers x-media-id, x-upload-id e x-part-number são obrigatórios.',
      })
      return
    }

    const body = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body || [])
    const result = await uploadVideoChunk(getR2Client(), {
      mediaId,
      uploadId,
      partNumber,
      body,
    })
    res.json(result)
  } catch (err) {
    console.error('[PUT /api/media/video/chunk]', err)
    handleHttpError(res, err, 'Falha ao enviar chunk.')
  }
})

mediaRouter.post('/video/complete', async (req, res) => {
  try {
    const mediaId =
      typeof req.body?.mediaId === 'string' ? req.body.mediaId : ''
    const uploadId =
      typeof req.body?.uploadId === 'string' ? req.body.uploadId : ''
    const parts = Array.isArray(req.body?.parts) ? req.body.parts : []

    const item = await completeVideoUpload(getR2Client(), {
      mediaId,
      uploadId,
      parts: parts.map(
        (p: {
          etag?: string
          ETag?: string
          partNumber?: number
          PartNumber?: number
        }) => ({
          etag: String(p.etag || p.ETag || ''),
          partNumber: Number(p.partNumber || p.PartNumber),
        }),
      ),
    })
    res.status(201).json({ item })
  } catch (err) {
    console.error('[POST /api/media/video/complete]', err)
    handleHttpError(res, err, 'Falha ao finalizar upload de vídeo.')
  }
})

mediaRouter.post('/video/abort', async (req, res) => {
  try {
    const mediaId =
      typeof req.body?.mediaId === 'string' ? req.body.mediaId : ''
    const uploadId =
      typeof req.body?.uploadId === 'string' ? req.body.uploadId : ''
    await abortVideoUpload(getR2Client(), { mediaId, uploadId })
    res.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/media/video/abort]', err)
    res.status(500).json({ error: 'Falha ao abortar upload.' })
  }
})

mediaRouter.get('/:id/file', async (req, res) => {
  try {
    const variant = (req.query.variant as FileVariant) || 'display'
    if (!['display', 'original', 'poster'].includes(variant)) {
      res.status(400).json({ error: 'variant inválido.' })
      return
    }

    const file = await resolveLocalFile(req.params.id, variant)
    if (!file) {
      res.status(404).json({ error: 'Arquivo local não encontrado.' })
      return
    }

    res.setHeader('Content-Type', file.contentType)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.sendFile(file.absolutePath)
  } catch (err) {
    console.error('[GET /api/media/:id/file]', err)
    res.status(500).json({ error: 'Falha ao servir arquivo.' })
  }
})
