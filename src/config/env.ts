import 'dotenv/config'
import path from 'node:path'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

export const env = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  publicApiUrl: (
    process.env.CORS_ORIGIN ||
    `http://localhost:${Number(process.env.PORT) || 3000}`
  ).replace(/\/$/, ''),
  localMediaDir:
    process.env.LOCAL_MEDIA_DIR ||
    path.join(process.cwd(), 'data', 'media'),
  r2: {
    accountId: () => required('R2_ACCOUNT_ID'),
    accessKeyId: () => required('R2_ACCESS_KEY_ID'),
    secretAccessKey: () => required('R2_SECRET_ACCESS_KEY'),
    bucket: () => required('R2_BUCKET'),
    publicUrl: () => required('R2_PUBLIC_URL').replace(/\/$/, ''),
  },
}
