/** Pure helpers for rider-to-rider promo codes. No network. */

import { WEB_ORIGIN } from '../../shared/productLinks.js'

export const RIDER_SOCIAL_TYPE = 'rider_social'

/** Defaults match rider_referral_config seed. Ops can change the table. */
export const DEFAULT_RIDER_SOCIAL_REWARDS = {
  referrerCreditCents: 500,
  referredDiscountKind: 'percent',
  referredPercentOff: 20,
  referredCentsOff: 500,
}

export function normalizePromoCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16)
}

/** First name only. Emails and blank names become "Rider". */
export function riderFirstName(fullName) {
  const raw = String(fullName || '').trim()
  if (!raw || raw.includes('@')) return 'Rider'
  return raw.split(/\s+/)[0] || 'Rider'
}

export function formatCents(cents) {
  const n = Number(cents)
  if (!Number.isFinite(n)) return '$0.00'
  return `$${(n / 100).toFixed(2)}`
}

export function describeRiderSocialRewards(cfg) {
  const referrerCents = Number(
    cfg?.referrer_credit_cents ?? DEFAULT_RIDER_SOCIAL_REWARDS.referrerCreditCents,
  )
  const kind = cfg?.referred_discount_kind === 'fixed' ? 'fixed' : 'percent'
  const referred = kind === 'fixed'
    ? `${formatCents(cfg?.referred_cents_off ?? DEFAULT_RIDER_SOCIAL_REWARDS.referredCentsOff)} ride credit`
    : `${Number(cfg?.referred_percent_off ?? DEFAULT_RIDER_SOCIAL_REWARDS.referredPercentOff)}% of the first-ride fare as ride credit`
  return {
    referrer: `${formatCents(referrerCents)} ride credit`,
    referred,
    kind,
  }
}

const PROMO_STORAGE_KEY = 'clemson_promo_code'

export function readStoredPromo() {
  if (typeof window === 'undefined') return ''
  try {
    return normalizePromoCode(window.sessionStorage.getItem(PROMO_STORAGE_KEY) || '')
  } catch {
    return ''
  }
}

/** Read ?ref= or ?promo= from the hash route or the page query and remember it. */
export function capturePromoFromLocation() {
  if (typeof window === 'undefined') return ''
  const hash = window.location.hash || ''
  const hashQs = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const fromHash = new URLSearchParams(hashQs)
  const fromSearch = new URLSearchParams(window.location.search || '')
  const raw = fromHash.get('ref')
    || fromHash.get('promo')
    || fromSearch.get('ref')
    || fromSearch.get('promo')
    || ''
  const code = normalizePromoCode(raw)
  if (code) {
    try {
      window.sessionStorage.setItem(PROMO_STORAGE_KEY, code)
    } catch {
      /* ignore */
    }
    return code
  }
  return readStoredPromo()
}

export function riderPromoShareUrl(code) {
  const origin = typeof window !== 'undefined'
    ? window.location.origin
    : WEB_ORIGIN
  return `${origin}/#/sign-up?ref=${encodeURIComponent(normalizePromoCode(code))}`
}

export function riderPromoShareText(code) {
  const norm = normalizePromoCode(code)
  return `Join me on Clemson RIDES. Use code ${norm} when you sign up.`
}
