import fs from 'node:fs/promises'
import path from 'node:path'
import type { S3Client } from '@aws-sdk/client-s3'
import { env } from '../config/env.js'
import { putObject, publicUrlForKey } from './r2.js'

export type PutBothResult = {
  r2Ok: boolean
  localOk: boolean
  r2Url: string | null
}

function localPathForKey(key: string): string {
  return path.join(env.localMediaDir, key)
}

export async function ensureLocalDir(key: string): Promise<string> {
  const full = localPathForKey(key)
  await fs.mkdir(path.dirname(full), { recursive: true })
  return full
}

export async function putLocal(key: string, body: Buffer): Promise<void> {
  const full = await ensureLocalDir(key)
  await fs.writeFile(full, body)
}

export async function putBoth(
  client: S3Client | null,
  {
    key,
    body,
    contentType,
  }: {
    key: string
    body: Buffer
    contentType: string
  },
): Promise<PutBothResult> {
  const r2Promise = client
    ? putObject(client, { key, body, contentType })
    : Promise.reject(new Error('R2 client unavailable'))

  const [r2Result, localResult] = await Promise.allSettled([
    r2Promise,
    putLocal(key, body),
  ])

  const r2Ok = r2Result.status === 'fulfilled'
  const localOk = localResult.status === 'fulfilled'

  if (!r2Ok) {
    console.warn(
      `[storage] R2 put failed for ${key}:`,
      r2Result.status === 'rejected' ? r2Result.reason : 'unknown',
    )
  }
  if (!localOk) {
    console.warn(
      `[storage] Local put failed for ${key}:`,
      localResult.status === 'rejected' ? localResult.reason : 'unknown',
    )
  }

  if (!r2Ok && !localOk) {
    throw new Error('Falha ao salvar no R2 e no disco local')
  }

  return {
    r2Ok,
    localOk,
    r2Url: r2Ok ? r2Result.value : null,
  }
}

export function localFileUrl(
  mediaId: string,
  variant: 'display' | 'original' | 'poster',
): string {
  return `${env.publicApiUrl}/api/media/${mediaId}/file?variant=${variant}`
}

export function preferR2Url(
  key: string | null | undefined,
  r2Ok: boolean,
  mediaId: string,
  variant: 'display' | 'original' | 'poster',
  legacySrc?: string | null,
): string {
  if (key && r2Ok) return publicUrlForKey(key)
  if (key) return localFileUrl(mediaId, variant)
  return legacySrc || ''
}

export function getLocalAbsolutePath(key: string): string {
  return localPathForKey(key)
}

export async function localFileExists(key: string): Promise<boolean> {
  try {
    await fs.access(localPathForKey(key))
    return true
  } catch {
    return false
  }
}

export async function appendLocal(key: string, chunk: Buffer): Promise<void> {
  const full = await ensureLocalDir(key)
  await fs.appendFile(full, chunk)
}

export async function deleteLocal(key: string): Promise<void> {
  try {
    await fs.unlink(localPathForKey(key))
  } catch {
    /* ignore */
  }
}

export async function renameLocal(
  fromKey: string,
  toKey: string,
): Promise<void> {
  const from = localPathForKey(fromKey)
  const to = await ensureLocalDir(toKey)
  await fs.rename(from, to)
}
