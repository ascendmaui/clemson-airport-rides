/**
 * Campus ambassador link parsing and rider-facing copy.
 * Pure: no network, storage, or payout math.
 * code_type stays `ambassador`. Dollar amounts belong on the ambassador
 * ledger, never in copy shown to the referred rider.
 */

export const AMBASSADOR_CODE_TYPE = 'ambassador'
export const AMBASSADOR_STORAGE_KEY = 'clemson_ambassador_attribution'
export const LEGACY_AMBASSADOR_KEY = 'clemson_ambassador_code'

export function normalizeAmbassadorCode(raw) {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 40)
  if (!cleaned || cleaned === 'a' || cleaned === 'ambassador') return ''
  return cleaned
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function codeFromHash(text) {
  const match = String(text || '').match(/#\/(?:a|ambassador)\/([^/?#]+)/i)
  return match ? normalizeAmbassadorCode(safeDecode(match[1])) : ''
}

function codeFromPath(text) {
  const source = String(text || '')
  const match = source.match(/(?:clemsonrides:\/\/|https?:\/\/[^/]+\/|\/)a\/([^/?#]+)/i)
    || source.match(/^a\/([^/?#]+)/i)
  return match ? normalizeAmbassadorCode(safeDecode(match[1])) : ''
}

/** Pull a code from /a/:code, #/a/:code, #/ambassador/:code, or the app scheme. */
export function ambassadorCodeFromLocation({ pathname = '', hash = '', href = '' } = {}) {
  const hrefText = String(href || '')
  const hashSource = hash || (hrefText.includes('#') ? hrefText.slice(hrefText.indexOf('#')) : '')
  const fromHash = codeFromHash(hashSource)
  if (fromHash) return fromHash
  const pathSource = pathname || hrefText.split('#')[0]
  return codeFromPath(pathSource)
}

export function ambassadorLobbyCopy(code) {
  const normalized = normalizeAmbassadorCode(code)
  if (!normalized) return null
  return {
    code: normalized,
    code_type: AMBASSADOR_CODE_TYPE,
    title: 'Referred by a campus ambassador',
    body: 'This carpool is attributed to them. Your fare does not change.',
  }
}

export function ambassadorSavedCopy() {
  return {
    title: 'Referred by a campus ambassador',
    body: 'Your fare does not change. This link is attached when you book a carpool.',
  }
}

export function packAttribution(code, userId = null) {
  const normalized = normalizeAmbassadorCode(code)
  if (!normalized) return ''
  return JSON.stringify({
    code: normalized,
    code_type: AMBASSADOR_CODE_TYPE,
    userId: userId || null,
  })
}

export function unpackAttribution(raw) {
  if (!raw || typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    const code = normalizeAmbassadorCode(parsed?.code)
    if (!code || parsed?.code_type !== AMBASSADOR_CODE_TYPE) return null
    const userId = typeof parsed.userId === 'string' && parsed.userId ? parsed.userId : null
    return { code, code_type: AMBASSADOR_CODE_TYPE, userId }
  } catch {
    const code = normalizeAmbassadorCode(raw)
    if (!code) return null
    return { code, code_type: AMBASSADOR_CODE_TYPE, userId: null }
  }
}

/**
 * Signed-out readers only see an unbound code.
 * A signed-in reader sees their own code, or a code saved before sign-in.
 */
export function attributionForUser(raw, userId) {
  const record = unpackAttribution(raw)
  if (!record) return null
  if (userId == null || userId === '') return record.userId ? null : record
  if (record.userId && record.userId !== userId) return null
  return record
}
