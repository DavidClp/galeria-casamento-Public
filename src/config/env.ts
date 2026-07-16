import 'dotenv/config'

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
  r2: {
    accountId: () => required('R2_ACCOUNT_ID'),
    accessKeyId: () => required('R2_ACCESS_KEY_ID'),
    secretAccessKey: () => required('R2_SECRET_ACCESS_KEY'),
    bucket: () => required('R2_BUCKET'),
    publicUrl: () => required('R2_PUBLIC_URL').replace(/\/$/, ''),
  },
}
