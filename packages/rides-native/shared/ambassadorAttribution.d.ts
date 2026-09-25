export const AMBASSADOR_CODE_TYPE: 'ambassador'
export const AMBASSADOR_STORAGE_KEY: string
export const LEGACY_AMBASSADOR_KEY: string

export type AmbassadorAttribution = {
  code: string
  code_type: 'ambassador'
  userId: string | null
}

export function normalizeAmbassadorCode(raw: unknown): string
export function ambassadorCodeFromLocation(input?: {
  pathname?: string
  hash?: string
  href?: string
}): string
export function ambassadorLobbyCopy(code: unknown): {
  code: string
  code_type: 'ambassador'
  title: string
  body: string
} | null
export function ambassadorSavedCopy(): { title: string; body: string }
export function packAttribution(code: string | null | undefined, userId?: string | null): string
export function unpackAttribution(raw: string | null | undefined): AmbassadorAttribution | null
export function attributionForUser(raw: string | null | undefined, userId?: string | null): AmbassadorAttribution | null
