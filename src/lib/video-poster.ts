import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

export async function extractVideoPoster(
  input: Buffer | string,
): Promise<Buffer | null> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'galeria-poster-'))
  const inputPath =
    typeof input === 'string'
      ? input
      : path.join(tmpDir, `input-${randomUUID()}`)
  const outputPath = path.join(tmpDir, `poster-${randomUUID()}.webp`)

  try {
    if (typeof input !== 'string') {
      await fs.writeFile(inputPath, input)
    }

    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-ss',
        '0.5',
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-vf',
        'scale=1280:-2',
        '-c:v',
        'libwebp',
        '-quality',
        '75',
        outputPath,
      ],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
    )

    return await fs.readFile(outputPath)
  } catch (err) {
    console.warn(
      '[video] poster extraction failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}
