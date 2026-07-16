import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { env } from '../config/env.js'

export function createR2Client(): S3Client {
  const accountId = env.r2.accountId()
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.r2.accessKeyId(),
      secretAccessKey: env.r2.secretAccessKey(),
    },
  })
}

export async function putObject(
  client: S3Client,
  {
    key,
    body,
    contentType,
  }: {
    key: string
    body: Buffer
    contentType: string
  },
): Promise<string> {
  await client.send(
    new PutObjectCommand({
      Bucket: env.r2.bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
  return `${env.r2.publicUrl()}/${key}`
}
