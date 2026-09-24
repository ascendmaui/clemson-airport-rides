export const LICENSE_REVIEW_STATUS: string

export function reviewLicenseImage(input?: {
  mimeType?: string
  size?: number
  width?: number
  height?: number
  text?: string
}): { ok: boolean; approved: boolean; reviewStatus: string | null; message: string }

export function licensePendingCopy(docType: string): string

export function extractReadableText(input: string | Uint8Array | null | undefined): string

export function matchRegistration(input?: {
  text?: string
  make?: string
  model?: string
  color?: string
  plate?: string
}): {
  status: 'matched' | 'mismatch' | 'unreadable'
  matched: boolean
  reviewStatus: string
  message: string
  misses?: string[]
}
