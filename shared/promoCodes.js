/**
 * Admin-generated promo codes for Clemson Rides. Pure helpers, no network.
 * Server: server/promoCodes.js. SQL: supabase/migrations/20261015160000_promo_campaign_codes.sql.
 *
 * Money rules
 * - A rider code lowers what the rider pays: the card hold (pre-auth) and the
 *   captured fare. trips.fare_cents keeps the pre-promo fare, so driver pay
 *   (80% of it, or the accept-locked driver_net_cents) never moves. The
 *   platform funds the whole discount.
 * - Driver codes are a flat signup incentive. They are recorded, not paid.
 *   Any payout must go through payout approval (#554).
 *
 * No-stack rule (one promo per ride)
 * - At most one campaign code per trip (unique trip_id in the database).
 * - A code does not stack with the recurring discounts (Clemson student 10%,
 *   Tiger Pass 10%). The server prices the ride both ways and the rider gets
 *   the better one: either the recurring discounts, or the code on the list
 *   fare with no recurring discount. If the recurring discounts win, the code
 *   is not used up.
 * - The standing offers in shared/standingPromos.js (50% first ride, etc.)
 *   are untouched; campaign codes do not change their selection logic.
 * - The Friday coupon codes (shared/weeklyCoupon.js) are display-only today
 *   and cannot be shadowed by a campaign code.
 */
import { WEEKLY_COUPON_CONCEPTS } from './weeklyCoupon.js'

export const PROMO_SIDES = Object.freeze(['rider', 'driver'])
export const PROMO_DISCOUNT_TYPES = Object.freeze(['percent', 'flat'])

/** Safety guardrails. The SQL check constraints match these. */
export const PROMO_LIMITS = Object.freeze({
  minCodeLength: 4,
  maxCodeLength: 16,
  maxPercentBps: 5000,
  maxFlatCents: 5000,
  maxDiscountCapCents: 5000,
  maxMinTripCents: 100000,
  maxRedemptions: 10000,
  maxPerAccount: 10,
  maxBudgetCents: 5000000,
  maxLifetimeDays: 366,
  maxBatch: 500,
  defaultPercentCapCents: 1500,
})

const DAY_MS = 24 * 60 * 60 * 1000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const cents = (value) => Math.max(0, Math.round(Number(value) || 0))

export function normalizePromoCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, PROMO_LIMITS.maxCodeLength)
}

export function isValidPromoCode(code) {
  const norm = normalizePromoCode(code)
  return norm === String(code || '') && norm.length >= PROMO_LIMITS.minCodeLength
}

/** Friday coupons are PREFIX + yymmdd. A campaign code may not look like one. */
export function looksLikeWeeklyCoupon(code) {
  const norm = normalizePromoCode(code)
  return WEEKLY_COUPON_CONCEPTS.some((concept) => {
    const prefix = concept.codePrefix.toUpperCase()
    return norm.startsWith(prefix) && /^\d{6}$/.test(norm.slice(prefix.length))
  })
}

function intOrNull(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : NaN
}

function dateOrNull(value) {
  if (value == null || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? 'invalid' : d
}

/**
 * Validate an admin definition. Accepts percent as whole percent
 * (percentOff: 20) or bps (percentOffBps: 2000), and dollars or cents.
 */
export function validatePromoDefinition(input = {}, { now = new Date() } = {}) {
  const errors = []
  const side = String(input.side || '').toLowerCase()
  if (!PROMO_SIDES.includes(side)) errors.push('side must be rider or driver')
  const discountType = String(input.discountType ?? input.discount_type ?? '').toLowerCase()
  if (!PROMO_DISCOUNT_TYPES.includes(discountType)) errors.push('discountType must be percent or flat')

  let percentOffBps = 0
  let amountOffCents = 0
  if (discountType === 'percent') {
    const bps = input.percentOffBps ?? input.percent_off_bps
    percentOffBps = bps != null && bps !== '' ? intOrNull(bps) : intOrNull(Number(input.percentOff) * 100)
    if (!Number.isFinite(percentOffBps) || percentOffBps <= 0 || percentOffBps > PROMO_LIMITS.maxPercentBps) {
      errors.push(`percent off must be between 1% and ${PROMO_LIMITS.maxPercentBps / 100}%`)
    }
    if (side === 'driver') errors.push('driver codes are flat only (a signup incentive in dollars)')
  } else if (discountType === 'flat') {
    const raw = input.amountOffCents ?? input.amount_off_cents
    amountOffCents = raw != null && raw !== '' ? intOrNull(raw) : intOrNull(Number(input.amountOffDollars) * 100)
    if (!Number.isFinite(amountOffCents) || amountOffCents <= 0 || amountOffCents > PROMO_LIMITS.maxFlatCents) {
      errors.push(`flat amount must be between $0.01 and $${PROMO_LIMITS.maxFlatCents / 100}`)
    }
  }

  let maxDiscountCents = intOrNull(input.maxDiscountCents ?? input.max_discount_cents)
  if (discountType === 'percent' && maxDiscountCents == null) maxDiscountCents = PROMO_LIMITS.defaultPercentCapCents
  if (discountType === 'flat') maxDiscountCents = null
  if (maxDiscountCents != null && (!Number.isFinite(maxDiscountCents) || maxDiscountCents < 1 || maxDiscountCents > PROMO_LIMITS.maxDiscountCapCents)) {
    errors.push(`max discount must be between $0.01 and $${PROMO_LIMITS.maxDiscountCapCents / 100}`)
  }

  const minTripCents = intOrNull(input.minTripCents ?? input.min_trip_cents) ?? 0
  if (!Number.isFinite(minTripCents) || minTripCents < 0 || minTripCents > PROMO_LIMITS.maxMinTripCents) {
    errors.push('minimum trip value is out of range')
  }
  if (side === 'driver' && minTripCents > 0) errors.push('minimum trip value applies to rider codes only')

  const maxRedemptions = intOrNull(input.maxRedemptions ?? input.max_redemptions)
  if (!Number.isFinite(maxRedemptions) || maxRedemptions == null || maxRedemptions < 1 || maxRedemptions > PROMO_LIMITS.maxRedemptions) {
    errors.push(`max redemptions is required (1 to ${PROMO_LIMITS.maxRedemptions})`)
  }
  const perAccountLimit = intOrNull(input.perAccountLimit ?? input.per_account_limit) ?? 1
  if (!Number.isFinite(perAccountLimit) || perAccountLimit < 1 || perAccountLimit > PROMO_LIMITS.maxPerAccount) {
    errors.push(`per-account limit must be 1 to ${PROMO_LIMITS.maxPerAccount}`)
  }
  const budgetCents = intOrNull(input.budgetCents ?? input.budget_cents)
  if (budgetCents != null && (!Number.isFinite(budgetCents) || budgetCents < 1 || budgetCents > PROMO_LIMITS.maxBudgetCents)) {
    errors.push('budget is out of range')
  }

  const clock = now instanceof Date ? now : new Date(now)
  const startsRaw = dateOrNull(input.startsAt ?? input.starts_at)
  const startsAt = startsRaw === 'invalid' ? null : (startsRaw || clock)
  if (startsRaw === 'invalid') errors.push('start date is not a date')
  const expiresRaw = dateOrNull(input.expiresAt ?? input.expires_at)
  if (!expiresRaw || expiresRaw === 'invalid') errors.push('expiration date is required')
  const expiresAt = expiresRaw instanceof Date ? expiresRaw : null
  if (expiresAt && startsAt) {
    if (expiresAt <= startsAt) errors.push('expiration must be after the start')
    if (expiresAt <= clock) errors.push('expiration must be in the future')
    if (expiresAt.getTime() - startsAt.getTime() > PROMO_LIMITS.maxLifetimeDays * DAY_MS) {
      errors.push(`a code can live at most ${PROMO_LIMITS.maxLifetimeDays} days`)
    }
  }

  const campaign = input.campaign == null ? null : String(input.campaign).trim().slice(0, 80) || null
  const notes = input.notes == null ? null : String(input.notes).trim().slice(0, 500) || null

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    row: {
      side,
      discount_type: discountType,
      percent_off_bps: discountType === 'percent' ? percentOffBps : 0,
      amount_off_cents: discountType === 'flat' ? amountOffCents : 0,
      max_discount_cents: maxDiscountCents,
      min_trip_cents: minTripCents,
      starts_at: startsAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      max_redemptions: maxRedemptions,
      per_account_limit: perAccountLimit,
      limit_per_device: input.limitPerDevice !== false,
      limit_per_card: input.limitPerCard !== false,
      budget_cents: budgetCents,
      public_listing: input.publicListing === true,
      active: true,
      campaign,
      notes,
    },
  }
}

/** Codes for a batch: one named code, or `count` random codes with a prefix. */
export function planPromoCodes({ code, prefix, count = 1 } = {}, random = Math.random) {
  if (code) {
    const raw = String(code).trim().toUpperCase()
    const norm = normalizePromoCode(raw)
    if (norm !== raw || norm.length < PROMO_LIMITS.minCodeLength) {
      return { ok: false, error: 'Codes are 4–16 letters or numbers.' }
    }
    if (looksLikeWeeklyCoupon(norm)) return { ok: false, error: 'That looks like a Friday coupon code. Pick another.' }
    return { ok: true, codes: [norm] }
  }
  const n = Math.round(Number(count) || 0)
  if (n < 1 || n > PROMO_LIMITS.maxBatch) return { ok: false, error: `Generate 1 to ${PROMO_LIMITS.maxBatch} codes at a time.` }
  const head = normalizePromoCode(prefix).slice(0, 8)
  const tail = Math.max(6, PROMO_LIMITS.minCodeLength - head.length)
  const out = new Set()
  let guard = 0
  while (out.size < n && guard < n * 20) {
    guard += 1
    let body = ''
    for (let i = 0; i < tail; i += 1) body += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
    const next = `${head}${body}`.slice(0, PROMO_LIMITS.maxCodeLength)
    if (!looksLikeWeeklyCoupon(next)) out.add(next)
  }
  if (out.size < n) return { ok: false, error: 'Could not generate unique codes.' }
  return { ok: true, codes: [...out] }
}

/** Discount on a rider fare. Mirrors SQL promo_compute_discount. */
export function promoDiscountCents(rule, fareCents, { enforceMinimum = true } = {}) {
  const fare = cents(fareCents)
  if (!rule || fare <= 0) return 0
  const type = rule.discount_type ?? rule.discountType
  const min = cents(rule.min_trip_cents ?? rule.minTripCents)
  if (enforceMinimum && fare < min) return 0
  let off = 0
  if (type === 'percent') {
    off = Math.round((fare * cents(rule.percent_off_bps ?? rule.percentOffBps)) / 10000)
    const cap = rule.max_discount_cents ?? rule.maxDiscountCents
    if (cap != null && cap !== '') off = Math.min(off, cents(cap))
  } else if (type === 'flat') {
    off = cents(rule.amount_off_cents ?? rule.amountOffCents)
  }
  return Math.min(fare, off)
}

/** Snapshot stored on trips.metadata.promo (server-written; clients cannot write trip metadata). */
export function promoTripSnapshot(reservation, { listFareCents, recurringFareCents } = {}) {
  if (!reservation?.ok || !reservation.redemption_id) return null
  return {
    redemption_id: reservation.redemption_id,
    code: reservation.code,
    code_id: reservation.code_id || null,
    discount_type: reservation.discount_type,
    percent_off_bps: cents(reservation.percent_off_bps),
    amount_off_cents: cents(reservation.amount_off_cents),
    max_discount_cents: reservation.max_discount_cents == null ? null : cents(reservation.max_discount_cents),
    min_trip_cents: cents(reservation.min_trip_cents),
    estimated_discount_cents: cents(reservation.discount_cents),
    list_fare_cents: listFareCents == null ? null : cents(listFareCents),
    recurring_fare_cents: recurringFareCents == null ? null : cents(recurringFareCents),
    funded_by: 'platform',
    no_stack: true,
  }
}

export function readTripPromo(trip) {
  const promo = trip?.metadata?.promo
  if (!promo || typeof promo !== 'object' || !promo.redemption_id) return null
  return promo
}

/**
 * Discount on the final fare at capture. The minimum trip value is checked at
 * booking, not here, so a shortened ride keeps its code (capped at the fare).
 */
export function tripPromoDiscountCents(trip, fareCents = trip?.fare_cents) {
  const promo = readTripPromo(trip)
  if (!promo) return 0
  return promoDiscountCents(promo, fareCents, { enforceMinimum: false })
}

/** What the rider pays for the fare portion after the trip's code. */
export function riderFareAfterPromoCents(trip, fareCents = trip?.fare_cents) {
  const fare = cents(fareCents)
  return Math.max(0, fare - tripPromoDiscountCents(trip, fare))
}

/**
 * No-stack precedence. recurringFareCents: fare with student / Tiger Pass.
 * listFareCents: same ride with neither. The rider gets the lower price.
 */
export function choosePromoOrRecurring({ recurringFareCents, listFareCents, promoDiscountCents: off }) {
  const recurring = cents(recurringFareCents)
  const list = cents(listFareCents)
  const withCode = Math.max(0, list - Math.min(list, cents(off)))
  if (cents(off) <= 0) return { usePromo: false, reason: 'below_minimum', riderPaysCents: recurring }
  if (withCode < recurring) return { usePromo: true, riderPaysCents: withCode, fareCents: list }
  return { usePromo: false, reason: 'better_discount_applied', riderPaysCents: recurring }
}

const REASONS = {
  not_found: 'That code is not valid.',
  wrong_side: 'That code is not valid for this app.',
  inactive: 'That code is no longer active.',
  not_started: 'That code is not active yet.',
  expired: 'That code has expired.',
  max_redemptions: 'That code has been fully redeemed.',
  per_account_limit: 'You have already used that code.',
  device_limit: 'That code was already used on this device.',
  card_limit: 'That code was already used with this card.',
  below_minimum: 'This ride is below the minimum for that code.',
  budget_exhausted: 'That code has been fully redeemed.',
  too_many_attempts: 'Too many tries. Wait an hour and try again.',
  better_discount_applied: 'Your student or Tiger Pass price is already lower, so the code was not used. It stays available.',
  no_code: 'No code to apply.',
  sign_in_required: 'Sign in to use a code.',
}

export function promoReasonMessage(reason) {
  return REASONS[reason] || 'That code could not be applied.'
}

const usd = (c) => `$${(cents(c) / 100).toFixed(2).replace(/\.00$/, '')}`

export function describePromo(row) {
  if (!row) return ''
  const type = row.discount_type ?? row.discountType
  if ((row.side ?? 'rider') === 'driver') return `${usd(row.amount_off_cents ?? row.amountOffCents)} driver signup bonus`
  let text = type === 'percent'
    ? `${cents(row.percent_off_bps ?? row.percentOffBps) / 100}% off`
    : `${usd(row.amount_off_cents ?? row.amountOffCents)} off`
  const cap = row.max_discount_cents ?? row.maxDiscountCents
  if (type === 'percent' && cap) text += ` (up to ${usd(cap)})`
  const min = cents(row.min_trip_cents ?? row.minTripCents)
  if (min > 0) text += ` on rides ${usd(min)}+`
  return text
}

/** Marketing feed row: only what a campaign page needs. No counts, no internals. */
export function publicCampaignRow(row) {
  return {
    code: row.code,
    side: row.side,
    campaign: row.campaign || null,
    description: describePromo(row),
    discountType: row.discount_type,
    percentOff: row.discount_type === 'percent' ? cents(row.percent_off_bps) / 100 : null,
    amountOffCents: row.discount_type === 'flat' ? cents(row.amount_off_cents) : null,
    maxDiscountCents: row.max_discount_cents ?? null,
    minTripCents: cents(row.min_trip_cents),
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    terms: 'One per account, device and card. One promo per ride; does not combine with student or Tiger Pass pricing (you get the better price). Cannot exceed the fare.',
  }
}

const CSV_COLUMNS = [
  'code', 'side', 'campaign', 'description', 'discount_type', 'percent_off', 'amount_off_usd',
  'max_discount_usd', 'min_trip_usd', 'starts_at', 'expires_at', 'max_redemptions',
  'per_account_limit', 'redeemed', 'reserved', 'claimed', 'active', 'public_listing',
]

function csvCell(value) {
  if (value == null) return ''
  let text = String(value)
  // Spreadsheet formula injection guard.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function promoCodesCsv(rows = []) {
  const lines = [CSV_COLUMNS.join(',')]
  for (const row of rows) {
    const counts = row.counts || {}
    lines.push([
      row.code, row.side, row.campaign, describePromo(row), row.discount_type,
      row.discount_type === 'percent' ? cents(row.percent_off_bps) / 100 : '',
      row.discount_type === 'flat' ? (cents(row.amount_off_cents) / 100).toFixed(2) : '',
      row.max_discount_cents == null ? '' : (cents(row.max_discount_cents) / 100).toFixed(2),
      (cents(row.min_trip_cents) / 100).toFixed(2),
      row.starts_at, row.expires_at, row.max_redemptions, row.per_account_limit,
      cents(counts.redeemed), cents(counts.reserved), cents(counts.claimed),
      row.active ? 'yes' : 'no', row.public_listing ? 'yes' : 'no',
    ].map(csvCell).join(','))
  }
  return `${lines.join('\n')}\n`
}
