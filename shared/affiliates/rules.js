/** Pure affiliate rules shared by web, server, native and tests. */
import {
  AFFILIATE_LINK_ORIGIN,
  AFFILIATE_PARTNER_LABELS,
  AFFILIATE_PARTNER_TYPES,
  AFFILIATE_RATES_DEFAULTS,
} from './config.js'

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

/** Bounty for one qualified referral, from a rates object (DB or defaults). */
export function bountyCents(role, partnerType, rates = AFFILIATE_RATES_DEFAULTS) {
  const base = role === 'driver' ? rates.driver_first_trip_cents : rates.rider_first_ride_cents
  const bps = rates.partner_type_bps?.[partnerType] ?? 10000
  return Math.max(0, Math.round((Number(base) || 0) * bps / 10000))
}

/**
 * Group approved-eligible pending entries into a payout batch.
 * entries: [{id, affiliate_id, amount_cents, status, created_at}]
 */
export function planPayoutBatch(entries, { now = Date.now(), rates = AFFILIATE_RATES_DEFAULTS } = {}) {
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

/** True when a rider's completed fare meets the Option C minimum from config. */
export function riderFareQualifies(fareCents, rates = AFFILIATE_RATES_DEFAULTS) {
  const min = Number(rates?.rider_min_fare_cents)
  if (!Number.isFinite(min)) return true
  return (Number(fareCents) || 0) >= min
}

/** "12500" basis points → "1.25×". */
export function formatMultiplier(bps) {
  const value = (Number(bps) || 0) / 10000
  if (!Number.isFinite(value) || value <= 0) return '0×'
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '')
  return `${text}×`
}

/**
 * Display model for Option C. Screens render this instead of embedding
 * dollar amounts or multipliers.
 */
export function describeAffiliatePlan(rates = AFFILIATE_RATES_DEFAULTS) {
  const merged = {
    ...AFFILIATE_RATES_DEFAULTS,
    ...(rates || {}),
    partner_type_bps: {
      ...AFFILIATE_RATES_DEFAULTS.partner_type_bps,
      ...(rates?.partner_type_bps || {}),
    },
  }
  return {
    plan: merged.plan || 'option_c',
    plan_label: 'Option C',
    rider_first_ride_cents: merged.rider_first_ride_cents,
    driver_first_trip_cents: merged.driver_first_trip_cents,
    rider_min_fare_cents: merged.rider_min_fare_cents,
    hold_days: merged.hold_days,
    placeholder: merged.placeholder === true,
    multipliers_pending_confirmation: merged.multipliers_pending_confirmation !== false,
    multipliers_note: merged.multipliers_note,
    partners: AFFILIATE_PARTNER_TYPES.map((type) => {
      const bps = merged.partner_type_bps[type] ?? 10000
      return {
        type,
        label: AFFILIATE_PARTNER_LABELS[type],
        bps,
        multiplier_label: formatMultiplier(bps),
        bonus: bps !== 10000,
        rider_cents: bountyCents('rider', type, merged),
        driver_cents: bountyCents('driver', type, merged),
      }
    }),
  }
}

/** Only Stripe test keys may move money in this program. */
export function isStripeTestKey(key) {
  return typeof key === 'string' && key.startsWith('sk_test_')
}

/**
 * Affiliate Connect is test-mode only, on the Crimson Rides Stripe account.
 * A live key is refused. A key that names another account (ScreenshotSticky)
 * is refused even if it is shaped like a test key.
 */
export function isAffiliateTestKey(key) {
  if (!isStripeTestKey(key)) return false
  if (/screenshotsticky/i.test(key)) return false
  return true
}

const CONNECT_STATUSES = ['not_started', 'pending', 'verified', 'restricted']

/** @param {string} status */
export function isConnectStatus(status) {
  return CONNECT_STATUSES.includes(status)
}

/**
 * Map a Stripe Account object to the dashboard's four onboarding states.
 * No account → not_started. Ready to receive transfers → verified.
 * Disabled or rejected → restricted. Anything else with an account id → pending.
 * @param {object | null | undefined} account
 */
export function connectOnboardingStatus(account) {
  if (!account?.id) return 'not_started'
  const disabled = account.requirements?.disabled_reason || ''
  const transfers = account.capabilities?.transfers
  if (transfers === 'inactive') return 'restricted'
  if (disabled && disabled !== 'requirements.pending_verification' && disabled !== 'under_review') return 'restricted'
  const ready = account.payouts_enabled === true
    && account.details_submitted === true
    && (transfers === 'active' || transfers == null)
    && !disabled
  if (ready) return 'verified'
  return 'pending'
}

/** Account Link return and refresh URLs. Hash is not used; the SPA reads ?connect=. */
export function connectLinkUrls(origin) {
  const base = String(origin || 'https://clemsonrides.com').replace(/\/$/, '')
  return {
    refresh_url: `${base}/affiliates?connect=refresh`,
    return_url: `${base}/affiliates?connect=return`,
  }
}

const ALLOWED_APP_HOSTS = new Set(['clemsonrides.com', 'www.clemsonrides.com'])

/** Origins allowed to receive Stripe Account Link redirects. */
export function isAllowedAppOrigin(origin) {
  try {
    const url = new URL(origin)
    const host = url.hostname
    if (ALLOWED_APP_HOSTS.has(host)) return url.protocol === 'https:'
    if (host.endsWith('.vercel.app')) return url.protocol === 'https:'
    if (host === 'localhost' || host === '127.0.0.1') return url.protocol === 'http:' || url.protocol === 'https:'
    return false
  } catch {
    return false
  }
}

/**
 * Mask a referred person's name for the affiliate dashboard.
 * "Jordan Smith" → "J. S."; a bare email local-part → "j•••".
 */
export function maskReferralName(fullName, email) {
  const raw = String(fullName || '').trim()
  const name = raw.includes('@') ? '' : raw
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0].toUpperCase()}. ${parts[parts.length - 1][0].toUpperCase()}.`
  if (parts.length === 1 && parts[0][0]) return `${parts[0][0].toUpperCase()}.`
  const local = String(email || '').split('@')[0].replace(/[^a-z0-9]/gi, '')
  if (local) return `${local[0].toUpperCase()}•••`
  return 'Referral'
}

/** Dashboard label. Fraud reasons stay off the affiliate-facing copy. */
export function referralStatusLabel(row) {
  if (row?.status === 'qualified' && row?.role === 'driver') return 'First trip'
  if (row?.status === 'qualified') return 'First ride'
  if (row?.status === 'rejected') return "Didn't qualify"
  return 'Signed up'
}

/**
 * Payout history for the dashboard. Stripe events win when they share a
 * transfer id with a paid ledger row, so a webhook does not double-list it.
 */
export function payoutHistory(events = [], ledger = []) {
  const rows = []
  const seen = new Set()
  for (const event of events) {
    if (event?.stripe_object_id) seen.add(event.stripe_object_id)
    rows.push({
      id: event.id,
      event_type: event.event_type,
      amount_cents: event.amount_cents,
      status: event.status,
      created_at: event.created_at,
      ref: event.stripe_object_id || null,
    })
  }
  for (const entry of ledger) {
    if (entry?.status !== 'paid') continue
    if (entry.payout_ref && seen.has(entry.payout_ref)) continue
    rows.push({
      id: entry.id,
      event_type: entry.payout_method === 'stripe_connect' ? 'transfer.paid' : 'ride_credit',
      amount_cents: entry.amount_cents,
      status: 'paid',
      created_at: entry.paid_at || entry.created_at,
      ref: entry.payout_ref || null,
    })
  }
  return rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
}
