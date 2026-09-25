export function isClemsonEmail(email: unknown): boolean
export function displayFirstName(fullName: unknown, fallback?: string): string
export function normalizePromoCode(raw: unknown): string
export function mapAuthError(error: unknown): Error & { code?: string; status?: number; retryAfterSec?: number }
