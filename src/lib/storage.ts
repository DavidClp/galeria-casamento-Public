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

const ensuredDirs = new Set<string>()

function localPathForKey(key: string): string {
  return path.join(env.localMediaDir, key)
}

export async function ensureLocalDir(key: string): Promise<string> {
  const full = localPathForKey(key)
  const dir = path.dirname(full)
  if (!ensuredDirs.has(dir)) {
    await fs.mkdir(dir, { recursive: true })
    ensuredDirs.add(dir)
  }
  return full
}

export function putLocal(key: string, body: Buffer): Promise<void> {
  return ensureLocalDir(key).then((full) => fs.writeFile(full, body))
}

function scheduleLocalWrite(key: string, body: Buffer): void {
  void putLocal(key, body).catch((err) => {
    console.warn(
      `[storage] background local write failed for ${key}:`,
      err instanceof Error ? err.message : err,
    )
  })
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
  if (client) {
    try {
      const url = await putObject(client, { key, body, contentType })
      scheduleLocalWrite(key, body)
      return { r2Ok: true, localOk: true, r2Url: url }
    } catch (r2Err) {
      console.warn(
        `[storage] R2 put failed for ${key}:`,
        r2Err instanceof Error ? r2Err.message : r2Err,
      )
    }
  }

  try {
    await putLocal(key, body)
    return { r2Ok: false, localOk: true, r2Url: null }
  } catch (localErr) {
    console.warn(
      `[storage] Local put failed for ${key}:`,
      localErr instanceof Error ? localErr.message : localErr,
    )
    throw new Error('Falha ao salvar no R2 e no disco local')
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
