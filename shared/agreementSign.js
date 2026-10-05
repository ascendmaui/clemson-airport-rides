/** Signing-link rules shared by the API and tests. No network and no Node crypto. */

export const SIGN_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const EMAIL_NOT_CONFIGURED = 'Email sender not configured'

export const AGREEMENT_TEXT_LOCKED = 'Agreement text cannot be edited'

export function emailSenderConfigured(env = {}) {
  const key = String(env.RESEND_API_KEY || '').trim()
  const from = String(env.RESEND_FROM || '').trim()
  return Boolean(key && !key.includes('placeholder') && from)
}

export function assessSignLink({ link, viewerId, now = Date.now() } = {}) {
  if (!link) return { ok: false, reason: 'missing' }
  if (link.revoked_at) return { ok: false, reason: 'revoked' }
  if (link.used_at) return { ok: false, reason: 'used' }
  const expires = new Date(link.expires_at).getTime()
  if (!Number.isFinite(expires) || expires <= now) return { ok: false, reason: 'expired' }
  if (!viewerId || link.profile_id !== viewerId) return { ok: false, reason: 'owner' }
  return { ok: true, reason: null }
}

export function signLinkMessage(reason) {
  switch (reason) {
    case 'missing':
      return 'This signing link is not valid.'
    case 'revoked':
      return 'This signing link is no longer valid.'
    case 'used':
      return 'This signing link was already used.'
    case 'expired':
      return 'This signing link has expired.'
    case 'owner':
      return 'This signing link belongs to another driver.'
    default: {
      const unknown = reason
      return unknown ? String(unknown) : 'This signing link is not valid.'
    }
  }
}

export function rejectAgreementTextEdit(body) {
  if (!body || typeof body !== 'object') return null
  if (body.html != null || body.agreementHtml != null || body.agreement_html != null) {
    return { status: 400, body: { error: AGREEMENT_TEXT_LOCKED } }
  }
  return null
}

const CORRECTABLE_FIELDS = [
  'legal_name',
  'address_line',
  'phone',
  'business_name',
  'vehicle_make',
  'vehicle_model',
  'vehicle_color',
  'vehicle_plate',
  'vehicle_seats',
]

export function particularUpdates(body) {
  const src = body?.particulars
  if (!src || typeof src !== 'object' || Array.isArray(src)) return {}
  const updates = {}
  for (const key of CORRECTABLE_FIELDS) {
    if (src[key] == null) continue
    updates[key] = String(src[key]).trim().slice(0, 200)
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'vehicle_seats')) {
    const seats = Number(updates.vehicle_seats)
    if (!Number.isInteger(seats) || seats < 1 || seats > 8) delete updates.vehicle_seats
  }
  return updates
}
