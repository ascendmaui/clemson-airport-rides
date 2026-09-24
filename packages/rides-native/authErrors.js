/** Auth helpers mirrored from src/lib/auth.jsx, src/lib/studentDomain.js, and src/lib/riderPromo.js. */

export const SIGNUP_RATE_LIMIT_COOLDOWN_SEC = 60
export const SIGNUP_RATE_LIMIT_STORAGE_KEY = 'clemson_signup_rate_limit_until'
export const PROMO_CLAIM_STATE_KEY = 'clemson_promo_claim_state'

const RATE_LIMIT_MSG =
  'Too many signup emails just now. Wait a minute and try again, or sign in if you already created an account.'

export function isClemsonEmail(email) {
  if (!email || typeof email !== 'string') return false
  const value = email.trim().toLowerCase()
  return value.endsWith('@clemson.edu') || value.endsWith('@g.clemson.edu')
}

export function normalizePromoCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16)
}

export function isRateLimitError(error) {
  const msg = error?.message || ''
  const status = error?.status
  return (
    status === 429 ||
    /rate limit|over_email_send_rate_limit|email rate|too many signup emails/i.test(msg)
  )
}

export function mapAuthError(error) {
  if (isRateLimitError(error)) {
    const err = new Error(RATE_LIMIT_MSG)
    err.code = 'over_email_send_rate_limit'
    err.status = 429
    err.retryAfterSec = SIGNUP_RATE_LIMIT_COOLDOWN_SEC
    return err
  }
  return error instanceof Error ? error : new Error(error?.message || 'Auth failed')
}

export async function markSignupRateLimited(storage, retryAfterSec = SIGNUP_RATE_LIMIT_COOLDOWN_SEC) {
  if (!storage) return
  const until = Date.now() + Math.max(1, Number(retryAfterSec) || SIGNUP_RATE_LIMIT_COOLDOWN_SEC) * 1000
  try {
    await storage.setItem(SIGNUP_RATE_LIMIT_STORAGE_KEY, String(until))
  } catch {
    /* ignore */
  }
}

export async function getSignupRateLimitRemainingSec(storage) {
  if (!storage) return 0
  try {
    const until = Number((await storage.getItem(SIGNUP_RATE_LIMIT_STORAGE_KEY)) || 0)
    if (!until) return 0
    const left = Math.ceil((until - Date.now()) / 1000)
    if (left <= 0) {
      await storage.removeItem(SIGNUP_RATE_LIMIT_STORAGE_KEY)
      return 0
    }
    return left
  } catch {
    return 0
  }
}

export function displayFirstName(fullName, fallback = 'Rider') {
  if (typeof fullName !== 'string') return fallback
  const token = fullName.trim().split(/\s+/)[0] || ''
  const cleaned = token.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9.'’-]+$/, '')
  return cleaned || fallback
}

export const RATING_STANDING = {
  watchBelow: 3,
  watchMinCount: 3,
  restrictBelow: 2.5,
  restrictMinCount: 5,
}

export function standingFromRatings(avg, count) {
  const c = Number(count) || 0
  const a = Number(avg)
  if (!Number.isFinite(a) || c <= 0) return 'good'
  if (c >= RATING_STANDING.restrictMinCount && a < RATING_STANDING.restrictBelow) return 'restricted'
  if (c >= RATING_STANDING.watchMinCount && a < RATING_STANDING.watchBelow) return 'watch'
  return 'good'
}
