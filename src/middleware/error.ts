import type { ErrorRequestHandler } from 'express'
import multer from 'multer'
import { HttpError } from '../types/media.js'
import { MAX_SIZE_MB } from '../services/media.service.js'

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res
        .status(400)
        .json({ error: `Arquivo excede o limite de ${MAX_SIZE_MB}MB.` })
      return
    }
    res.status(400).json({ error: err.message })
    return
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }

  console.error('[unhandled]', err)
  res.status(500).json({ error: 'Erro interno.' })
}
