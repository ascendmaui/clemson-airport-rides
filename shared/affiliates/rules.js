/** Pure affiliate rules shared by web, server, native and tests. */
import { AFFILIATE_LINK_ORIGIN, AFFILIATE_PARTNER_TYPES, AFFILIATE_RATES_PLACEHOLDER } from './config.js'

const CODE_RE = /^[A-Z0-9]{4,16}$/
// No 0/O/1/I/L to keep codes readable when said out loud or printed on a flyer.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function normalizeAffiliateCode(raw) {
  const code = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return CODE_RE.test(code) ? code : ''
}

export function affiliateLink(code) {
  const c = normalizeAffiliateCode(code)
  return c ? `${AFFILIATE_LINK_ORIGIN}/r/${c}` : ''
}

/** Code from a display name plus random suffix, e.g. "Tiger Tutors" -> TIGERT7K2. */
export function generateAffiliateCode(name, random = Math.random) {
  const stem = String(name || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'CR'
  let tail = ''
  for (let i = 0; i < 4; i++) tail += ALPHABET[Math.floor(random() * ALPHABET.length)]
  return normalizeAffiliateCode(stem + tail)
}

export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

export function isE2EEmail(email) {
  return typeof email === 'string' && /^e2e\+[a-z0-9._-]+@clemsonrides\.com$/i.test(email)
}

export function validateAffiliateApplication(input = {}) {
  const errors = {}
  const partner_type = String(input.partner_type || '')
  if (!AFFILIATE_PARTNER_TYPES.includes(partner_type)) errors.partner_type = 'Pick a partner type'
  const display_name = String(input.display_name || '').trim()
  if (display_name.length < 2 || display_name.length > 80) errors.display_name = 'Enter your name or organization'
  const contact_email = String(input.contact_email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) errors.contact_email = 'Enter a valid email'
  const phone = normalizePhone(input.phone)
  if (input.phone && phone.length !== 10) errors.phone = 'Enter a 10-digit phone'
  if ((partner_type === 'campus_org' || partner_type === 'local_business') && !String(input.org_name || '').trim()) {
    errors.org_name = 'Organization name required'
  }
  if (!input.agree) errors.agree = 'Accept the partner terms'
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      partner_type,
      display_name,
      contact_email,
      phone: phone || null,
      org_name: String(input.org_name || '').trim().slice(0, 120) || null,
      website: String(input.website || '').trim().slice(0, 200) || null,
      audience: String(input.audience || '').trim().slice(0, 500) || null,
    },
  }
}

/**
 * Decide whether a signup may be attributed. Mirrors the SQL guards so the
 * API can answer quickly; the qualify trigger re-checks at ride time.
 */
export function attributionDecision({ affiliate, user, profile, affiliateProfile, existing, priorCompleted = 0 }) {
  if (!affiliate || affiliate.status !== 'active') return { ok: false, code: 'inactive_code' }
  if (!user?.id) return { ok: false, code: 'sign_in_required' }
  if (affiliate.user_id && affiliate.user_id === user.id) return { ok: false, code: 'self_referral' }
  const p1 = normalizePhone(profile?.phone)
  const p2 = normalizePhone(affiliateProfile?.phone || affiliate.phone)
  if (p1 && p2 && p1 === p2) return { ok: false, code: 'self_referral' }
  const e1 = String(user.email || profile?.email || '').toLowerCase()
  if (e1 && e1 === String(affiliate.contact_email || '').toLowerCase()) return { ok: false, code: 'self_referral' }
  if (isE2EEmail(e1) || user?.app_metadata?.e2e_test === true) return { ok: false, code: 'e2e_test' }
  if (existing) return { ok: false, code: 'already_attributed', duplicate: true }
  if (priorCompleted > 0) return { ok: false, code: 'not_new' }
  return { ok: true }
}

/** Bounty for one qualified referral, from a rates object (DB or placeholder). */
export function bountyCents(role, partnerType, rates = AFFILIATE_RATES_PLACEHOLDER) {
  const base = role === 'driver' ? rates.driver_first_trip_cents : rates.rider_first_ride_cents
  const bps = rates.partner_type_bps?.[partnerType] ?? 10000
  return Math.max(0, Math.round((Number(base) || 0) * bps / 10000))
}

/**
 * Group approved-eligible pending entries into a payout batch.
 * entries: [{id, affiliate_id, amount_cents, status, created_at}]
 */
export function planPayoutBatch(entries, { now = Date.now(), rates = AFFILIATE_RATES_PLACEHOLDER } = {}) {
  const holdMs = (Number(rates.hold_days) || 0) * 86400000
  const eligible = entries.filter((e) => e.status === 'pending' && Date.parse(e.created_at) <= now - holdMs)
  const byAffiliate = new Map()
  for (const e of eligible) {
    const list = byAffiliate.get(e.affiliate_id) || []
    list.push(e)
    byAffiliate.set(e.affiliate_id, list)
  }
  const include = []
  const rollover = []
  for (const [affiliate_id, list] of byAffiliate) {
    const total = list.reduce((s, e) => s + e.amount_cents, 0)
    if (total >= (Number(rates.min_payout_cents) || 0)) include.push({ affiliate_id, total_cents: total, entry_ids: list.map((e) => e.id) })
    else rollover.push({ affiliate_id, total_cents: total })
  }
  return { include, rollover, total_cents: include.reduce((s, g) => s + g.total_cents, 0) }
}

export function summarizeLedger(rows = []) {
  const out = { pending_cents: 0, approved_cents: 0, paid_cents: 0, void_cents: 0 }
  for (const r of rows) {
    const k = `${r.status}_cents`
    if (k in out) out[k] += Number(r.amount_cents) || 0
  }
  return out
}

/** Only Stripe test keys may move money in this program. */
export function isStripeTestKey(key) {
  return typeof key === 'string' && key.startsWith('sk_test_')
}
