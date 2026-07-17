import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
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

export function publicUrlForKey(key: string): string {
  return `${env.r2.publicUrl()}/${key}`
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
  return publicUrlForKey(key)
}

export async function createMultipartUpload(
  client: S3Client,
  { key, contentType }: { key: string; contentType: string },
): Promise<string> {
  const result = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: env.r2.bucket(),
      Key: key,
      ContentType: contentType,
    }),
  )
  if (!result.UploadId) {
    throw new Error('Falha ao iniciar multipart upload no R2')
  }
  return result.UploadId
}

export async function uploadPart(
  client: S3Client,
  {
    key,
    uploadId,
    partNumber,
    body,
  }: {
    key: string
    uploadId: string
    partNumber: number
    body: Buffer
  },
): Promise<string> {
  const result = await client.send(
    new UploadPartCommand({
      Bucket: env.r2.bucket(),
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body,
    }),
  )
  if (!result.ETag) {
    throw new Error(`Falha no upload da parte ${partNumber}`)
  }
  return result.ETag
}

export async function completeMultipartUpload(
  client: S3Client,
  {
    key,
    uploadId,
    parts,
  }: {
    key: string
    uploadId: string
    parts: { ETag: string; PartNumber: number }[]
  },
): Promise<string> {
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: env.r2.bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
      },
    }),
  )
  return publicUrlForKey(key)
}

export async function abortMultipartUpload(
  client: S3Client,
  { key, uploadId }: { key: string; uploadId: string },
): Promise<void> {
  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: env.r2.bucket(),
      Key: key,
      UploadId: uploadId,
    }),
  )
}
