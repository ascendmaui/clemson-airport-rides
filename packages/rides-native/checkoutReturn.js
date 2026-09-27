/**
 * Checkout return and session ID parsing helpers for web and native rider app.
 * Extracts Stripe checkout session IDs from success hashes, full URLs, and deep links.
 */

/**
 * First non-empty string. Blank strings are skipped, and a truthy number or
 * boolean must not hide a later string field (`sessionId: 123` in front of
 * `session_id`, or `url: 1` in front of `href`).
 *
 * @param {...unknown} values
 * @returns {string | null}
 */
function firstPresentString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value) return value
  }
  return null
}

/**
 * Extracts a Stripe checkout session ID (`cs_...`) from a URL, hash, query string, or object.
 * Returns the session ID string if found and valid, or null.
 *
 * @param {unknown} input - URL string, hash string, or object containing sessionId/session_id
 * @returns {string | null}
 */
export function parseCheckoutSessionId(input) {
  if (!input) return null

  // If object, check direct property or params property or url/href
  if (typeof input === 'object') {
    const candidate = firstPresentString(
      input.sessionId,
      input.session_id,
      input.params?.sessionId,
      input.params?.session_id,
    )
    if (typeof candidate === 'string' && candidate.trim().startsWith('cs_')) {
      return candidate.trim()
    }
    const url = firstPresentString(input.url, input.href, input.hash)
    if (url) {
      return parseCheckoutSessionId(url)
    }
    return null
  }

  if (typeof input !== 'string') return null
  const text = input.trim()
  if (!text) return null

  // If it's a bare session id (e.g. "cs_test_123" or "cs_live_123")
  if (/^cs_[a-zA-Z0-9_]+$/.test(text)) {
    return text
  }

  // Look for session_id or sessionId in query parameter format (?key=val or &key=val)
  // Handles query parameters before '#' and within the hash after '#'
  const match = text.match(/[?&](?:session_id|sessionId)=([^&#\s]+)/i)
  if (match && match[1]) {
    try {
      const decoded = decodeURIComponent(match[1]).trim()
      if (decoded.startsWith('cs_')) return decoded
    } catch {
      const trimmed = match[1].trim()
      if (trimmed.startsWith('cs_')) return trimmed
    }
  }

  return null
}

/**
 * Parses full checkout return parameters from a URL, hash, or object.
 *
 * @param {unknown} input
 * @returns {{
 *   sessionId: string | null,
 *   tripId: string | null,
 *   paid: boolean,
 *   canceled: boolean,
 *   scheduled: boolean,
 * }}
 */
export function parseCheckoutReturn(input) {
  const sessionId = parseCheckoutSessionId(input)
  let raw = ''
  let directParams = null

  if (typeof input === 'string') {
    raw = input
  } else if (input && typeof input === 'object') {
    if (typeof input.url === 'string') raw = input.url
    else if (typeof input.href === 'string') raw = input.href
    else if (typeof input.hash === 'string') raw = input.hash
    directParams = input.params || input
  }

  const queryParams = {}
  if (raw) {
    const matches = raw.matchAll(/[?&]([^&=#\s]+)=([^&#\s]*)/g)
    for (const m of matches) {
      try {
        queryParams[decodeURIComponent(m[1])] = decodeURIComponent(m[2])
      } catch {
        queryParams[m[1]] = m[2]
      }
    }
  }

  const merged = { ...queryParams, ...(directParams && typeof directParams === 'object' ? directParams : {}) }

  const tripId = merged.trip || merged.tripId || merged.trip_id || null
  const paid = merged.paid === '1' || merged.paid === 'true' || merged.paid === true
  const canceled = merged.canceled === '1' || merged.canceled === 'true' || merged.canceled === true
  const scheduled = Boolean(
    raw.includes('/schedule') ||
    raw.includes('schedule?') ||
    merged.scheduled === '1' ||
    merged.scheduled === 'true' ||
    merged.scheduled === true
  )

  return {
    sessionId,
    tripId: tripId ? String(tripId).trim() : null,
    paid,
    canceled,
    scheduled,
  }
}
