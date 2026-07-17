export type MediaKind = 'photo' | 'video'

export interface MediaItem {
  id: string
  type: MediaKind
  src: string
  srcOriginal?: string
  srcFallback?: string
  originalFallback?: string
  poster?: string | null
  posterFallback?: string | null
  guest: string
  date: string
}

export interface MediaListResponse {
  items: MediaItem[]
}

export interface UploadMediaError {
  file: string
  reason: string
}

export interface UploadMediaResult {
  items: MediaItem[]
  errors: UploadMediaError[]
}

export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}
