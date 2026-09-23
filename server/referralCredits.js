/**
 * Referral program credit amounts.
 * Keep in sync with the defaults in supabase/referrals_credit_ledger.sql
 * (markers REFERRAL_REFERRER_CENTS / REFERRAL_REFEREE_CENTS and function defaults).
 *
 * Granted once, to both people, when the referred user completes either:
 * - their first trip as a rider, or
 * - their first completed trip as a driver
 * whichever happens first.
 */

/** Platform credits for the person who shared the code. */
export const REFERRAL_REFERRER_CENTS = 1000

/** Platform credits for the new user who was referred. */
export const REFERRAL_REFEREE_CENTS = 1000

export const REFERRAL_CODE_PREFIX = 'TGR-'
export const REFERRAL_CODE_LENGTH = 6
/** Crockford-style alphabet: no I, O, 0, 1. */
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const CODE_BODY = `[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}`
const CODE_RE = new RegExp(`^${REFERRAL_CODE_PREFIX}${CODE_BODY}$`)
const BODY_RE = new RegExp(`^${CODE_BODY}$`)

export function formatCreditCents(cents) {
  const n = Number(cents)
  const safe = Number.isFinite(n) ? Math.trunc(n) : 0
  const sign = safe < 0 ? '-' : ''
  const abs = Math.abs(safe)
  const dollars = Math.floor(abs / 100)
  const rem = String(abs % 100).padStart(2, '0')
  return `${sign}$${dollars}.${rem}`
}

/**
 * Public label for someone else. First name only — never a last name or email.
 */
export function firstNameOnly(fullName) {
  const raw = String(fullName || '').trim()
  if (!raw || raw.includes('@')) return 'Friend'
  const token = raw.split(/\s+/)[0]
  const cleaned = token.replace(/[^\p{L}\p{M}\u0027\u2019\u002D]/gu, '')
  return cleaned || 'Friend'
}

export function normalizeReferralCode(raw) {
  if (raw == null) return ''
  let s = String(raw).trim()
  const fromPath = s.match(/\/r\/([A-Za-z0-9-]+)/i)
  if (fromPath) s = fromPath[1]
  const fromQuery = s.match(/[?&]ref=([A-Za-z0-9-]+)/i)
  if (fromQuery) s = decodeURIComponent(fromQuery[1])
  s = s.toUpperCase().replace(/\s+/g, '')
  if (BODY_RE.test(s)) s = `${REFERRAL_CODE_PREFIX}${s}`
  return s
}

export function isValidReferralCode(code) {
  return CODE_RE.test(String(code || ''))
}

export function referralPath(code) {
  return `/r/${encodeURIComponent(code)}`
}
