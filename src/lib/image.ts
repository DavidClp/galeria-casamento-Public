import sharp from 'sharp'

const WEBP_QUALITY = 78
const MAX_WIDTH = 1920

export type OptimizedImage = {
  original: Buffer
  display: Buffer | null
  displayContentType: string
}

export async function optimizeImage(
  buffer: Buffer,
  mime: string,
): Promise<OptimizedImage> {
  try {
    let pipeline = sharp(buffer, { failOn: 'none' }).rotate()
    const meta = await pipeline.metadata()

    if (meta.width && meta.width > MAX_WIDTH) {
      pipeline = pipeline.resize({
        width: MAX_WIDTH,
        withoutEnlargement: true,
      })
    }

    const display = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer()

    return {
      original: buffer,
      display,
      displayContentType: 'image/webp',
    }
  } catch (err) {
    console.warn(
      `[image] WebP optimization failed (${mime}):`,
      err instanceof Error ? err.message : err,
    )
    return {
      original: buffer,
      display: null,
      displayContentType: mime,
    }
  }
}
