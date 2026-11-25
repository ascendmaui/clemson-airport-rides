/**
 * Lightweight first-touch + last-touch campaign attribution for Clemson Rides.
 *
 * Captures standard UTM parameters (utm_source, utm_medium, utm_campaign,
 * utm_content, utm_term) and optional explicit affiliate parameter (?aff=CODE)
 * from both the root query string and hash-route query string without altering
 * ?ref= or ?promo= (which belong to riderPromo.js).
 */
import { normalizeAffiliateCode } from '../../shared/affiliates/rules.js'

const STORAGE_KEY = 'clemson_campaign_attribution'
const MAX_FIELD_LEN = 80
const MAX_SUMMARY_LEN = 220

export const UTM_KEYS = Object.freeze([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
])

const DRIVER_LANDING_PATHS = new Set(['drive', 'driver-signup', 'driver-onboarding', 'driver'])

function cleanValue(raw, max = MAX_FIELD_LEN) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function routePathFromLocation(loc) {
  const hash = String(loc?.hash || '').replace(/^#\/?/, '')
  if (hash) return hash.split('?')[0].split('/')[0] || 'landing'
  const pathname = String(loc?.pathname || '').replace(/^\/+/, '')
  return pathname ? pathname.split('/')[0] : 'landing'
}

/**
 * Extract sanitized UTM fields and optional explicit ?aff= affiliate code
 * from a location-like object ({ search, hash, pathname }).
 */
export function parseCampaignFromLocation(loc) {
  if (!loc) return null
  const searchParams = new URLSearchParams(String(loc.search || ''))
  const hash = String(loc.hash || '')
  const hashQs = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const hashParams = new URLSearchParams(hashQs)

  const get = (key) => cleanValue(hashParams.get(key) || searchParams.get(key) || '')
  const utm = {}
  let hasUtm = false
  for (const key of UTM_KEYS) {
    const val = get(key)
    if (val) {
      utm[key] = val
      hasUtm = true
    }
  }
  const aff = normalizeAffiliateCode(get('aff'))
  if (!hasUtm && !aff) return null

  return {
    ...utm,
    ...(aff ? { aff } : {}),
    landing_path: cleanValue(routePathFromLocation(loc), 48) || 'landing',
  }
}

function getStorage(storageOverride) {
  if (storageOverride !== undefined) return storageOverride
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function readCampaignAttribution({ storage } = {}) {
  const s = getStorage(storage)
  if (!s) return null
  try {
    const parsed = JSON.parse(s.getItem(STORAGE_KEY) || 'null')
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Capture UTM parameters and optional ?aff= partner code from the current URL.
 * Preserves first-touch fields while updating last-touch on later campaign links.
 */
export function captureCampaignAttribution({
  location: locOverride,
  storage,
  rememberAffiliate = null,
  now = Date.now(),
} = {}) {
  const loc = locOverride ?? (typeof window !== 'undefined' ? window.location : null)
  const hit = parseCampaignFromLocation(loc)
  const existing = readCampaignAttribution({ storage })
  if (!hit) return existing

  if (hit.aff && typeof rememberAffiliate === 'function') {
    const role = DRIVER_LANDING_PATHS.has(hit.landing_path) ? 'driver' : 'rider'
    rememberAffiliate(hit.aff, role)
  }

  const touch = { ...hit, at: now }
  const next = {
    first: existing?.first || touch,
    last: touch,
  }
  const s = getStorage(storage)
  try {
    s?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore storage quota or privacy-mode errors */
  }
  return next
}

/** Single-line attribution summary safe for lead notifications and logs. */
export function formatCampaignSummary(attribution) {
  const touch = attribution?.first || attribution?.last || attribution
  if (!touch || typeof touch !== 'object') return ''
  const parts = []
  for (const key of UTM_KEYS) {
    const val = cleanValue(touch[key])
    if (val) parts.push(`${key}=${val}`)
  }
  const aff = normalizeAffiliateCode(touch.aff)
  if (aff) parts.push(`aff=${aff}`)
  if (!parts.length) return ''
  const path = cleanValue(touch.landing_path, 48)
  if (path) parts.push(`landing=${path}`)
  return parts.join(' | ').slice(0, MAX_SUMMARY_LEN)
}
