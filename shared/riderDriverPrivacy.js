/**
 * Rider-facing driver identity. First name only.
 * Phone, last name, and last initial never go to a rider.
 */

const TITLES = new Set(['mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'miss', 'professor'])

const PRIVATE_KEYS = new Set([
  'phone',
  'phone_number',
  'mobile',
  'tel',
  'driver_phone',
  'last_name',
  'lastName',
  'surname',
  'family_name',
  'email',
])

function cleanToken(token) {
  return String(token || '').replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9.'’-]+$/, '')
}

/**
 * First given name. A one-letter token is a last initial, not a name, so it is dropped.
 * @param {unknown} value
 * @param {string} [fallback]
 */
export function riderDriverFirstName(value, fallback = '') {
  const raw = String(value ?? '').trim()
  if (!raw) return fallback
  let source = raw
  if (source.includes('@')) source = source.split('@')[0].trim()
  if (source.includes(',')) {
    const pieces = source.split(',').map((part) => part.trim()).filter(Boolean)
    if (pieces.length >= 2) source = pieces[1]
  }
  const tokens = source.split(/[\s._]+/).map(cleanToken).filter(Boolean)
  const token = tokens.find((part) => !TITLES.has(part.replace(/\./g, '').toLowerCase()))
  if (!token) return fallback
  const bare = token.replace(/\./g, '')
  if (bare.length < 2) return fallback
  return token
}

/** Allowlisted driver card. No phone, email, last name, or full name. */
export function selectRiderDriver(row, fallback = 'Driver') {
  if (!row || typeof row !== 'object') return null
  const out = {}
  for (const [key, value] of Object.entries(row)) {
    if (PRIVATE_KEYS.has(key) || key === 'full_name' || key === 'fullName') continue
    out[key] = value
  }
  const first = riderDriverFirstName(row.first_name || row.full_name || row.fullName || row.name, '')
  out.first_name = first || null
  if (row.name != null || row.first_name != null || row.full_name != null || row.fullName != null) {
    out.name = first || fallback
  }
  return out
}

/** Push and email bodies sent to a rider. Drops private keys and shortens a driver name field. */
export function sanitizeRiderNotice(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const out = {}
  for (const [key, value] of Object.entries(payload)) {
    if (PRIVATE_KEYS.has(key) || key === 'full_name' || key === 'fullName') continue
    if (key === 'data' && value && typeof value === 'object' && !Array.isArray(value)) {
      out.data = sanitizeRiderNotice(value)
      continue
    }
    if ((key === 'driverName' || key === 'driver_name' || key === 'name') && typeof value === 'string') {
      out[key] = riderDriverFirstName(value, '')
      continue
    }
    out[key] = value
  }
  return out
}

const PRIVATE_KEY_RE = /^(phone|phone_number|mobile|tel|driver_phone|last_name|lastName|surname|family_name|email)$/i

/** True when a rider-facing driver object still carries a phone or last name. */
export function riderDriverLeaks(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some((item) => riderDriverLeaks(item, seen))
  for (const [key, item] of Object.entries(value)) {
    if (PRIVATE_KEY_RE.test(key) || key === 'full_name' || key === 'fullName') return true
    if (item && typeof item === 'object' && riderDriverLeaks(item, seen)) return true
  }
  return false
}
