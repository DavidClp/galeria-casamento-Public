import { Router } from 'express'
import type { S3Client } from '@aws-sdk/client-s3'
import { createR2Client } from '../lib/r2.js'
import { upload } from '../middleware/upload.js'
import { listMedia, uploadMedia } from '../services/media.service.js'
import { HttpError } from '../types/media.js'

export const mediaRouter = Router()

let r2: S3Client | null = null

function getR2Client(): S3Client {
  if (!r2) {
    r2 = createR2Client()
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

    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message })
      return
    }

    res.status(500).json({ error: 'Falha ao enviar mídia.' })
  }
})
