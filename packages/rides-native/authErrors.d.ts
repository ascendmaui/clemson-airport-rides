export const SIGNUP_RATE_LIMIT_COOLDOWN_SEC: number
export const SIGNUP_RATE_LIMIT_STORAGE_KEY: string
export const PROMO_CLAIM_STATE_KEY: string

export const RATING_STANDING: {
  watchBelow: number
  watchMinCount: number
  restrictBelow: number
  restrictMinCount: number
}

export type AuthStorage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

export function isClemsonEmail(email: unknown): boolean
export function displayFirstName(fullName: unknown, fallback?: string): string
export function normalizePromoCode(raw: unknown): string
export function normalizeAuthEmail(email: unknown): string
export function isRateLimitError(error: unknown): boolean
export function isAccountExistsError(error: unknown): boolean
export function isInvalidCredentialsError(error: unknown): boolean
export function mapAuthError(error: unknown): Error & { code?: string; status?: number; retryAfterSec?: number }
export function markSignupRateLimited(storage: AuthStorage | null | undefined, retryAfterSec?: number): Promise<void>
export function getSignupRateLimitRemainingSec(storage: AuthStorage | null | undefined): Promise<number>
export function standingFromRatings(avg: unknown, count: unknown): 'good' | 'watch' | 'restricted'
