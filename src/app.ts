import express from 'express'
import cors from 'cors'
import { env } from './config/env.js'
import { errorHandler } from './middleware/error.js'
import { mediaRouter } from './routes/media.routes.js'

export function createApp() {
  const app = express()

  app.use(
    cors({
      origin: '*', // TODO: Change to the allowed origins
      methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'x-media-id',
        'x-upload-id',
        'x-part-number',
      ],
      exposedHeaders: ['ETag'],
    }),
  )

  app.use(express.json({ limit: '2mb' }))

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.use('/api/media', mediaRouter)
  app.use(errorHandler)

  return app
}
