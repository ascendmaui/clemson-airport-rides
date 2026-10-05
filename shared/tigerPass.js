/**
 * Frequent-rider subscription.
 * Rename the product by changing TIGER_PASS_NAME. product id stays tiger_pass.
 * Ride types stay Standard, Wait & Save, and Extra Comfort.
 */
import { cardDepositCents, percentOffCents, splitPlatformFee } from '../src/lib/fareRates.js'
import { isBlockedRideTier, isOfferedRideTier, rideOptionLabel } from './rideOptions.js'

export const TIGER_PASS_PRODUCT_ID = 'tiger_pass'

/** Display name. Every rider-facing string should read this, not a second literal. */
export const TIGER_PASS_NAME = 'Tiger Pass'

/** 10% off the fare after the student discount and before schedule-ahead and credits. */
export const TIGER_PASS_DISCOUNT_PCT = 10
export const TIGER_PASS_DISCOUNT_BPS = TIGER_PASS_DISCOUNT_PCT * 100

/** Monthly price charged by Checkout. Edit here only. */
export const TIGER_PASS_PRICE_CENTS = 999

/** How long a paid period lasts when Stripe does not send a period end. */
export const TIGER_PASS_PERIOD_MS = 32 * 24 * 60 * 60 * 1000

const CAR_TYPE_IDS = ['standard', 'wait', 'comfort']

export function tigerPassCarTypes() {
  return CAR_TYPE_IDS.map((id) => ({ id, name: rideOptionLabel(id) }))
}

export function tigerPassCopy(name = TIGER_PASS_NAME) {
  const label = String(name || TIGER_PASS_NAME)
  return {
    name: label,
    productId: TIGER_PASS_PRODUCT_ID,
    kicker: 'FREQUENT RIDER',
    discountLabel: `${TIGER_PASS_DISCOUNT_PCT}% off rides`,
    priceLabel: `$${(TIGER_PASS_PRICE_CENTS / 100).toFixed(2)} / month`,
    summary: `${label} takes ${TIGER_PASS_DISCOUNT_PCT}% off Standard, Wait & Save, and Extra Comfort.`,
    carTypesLabel: 'Preferred ride types',
    driversLabel: 'Preferred drivers',
    savedDriversLabel: 'Saved drivers',
    demoNote: 'Map preview cars cannot be saved as favorites and are never used for matching.',
  }
}

export function subscriptionIsActive(row, now = new Date()) {
  if (!row || row.status !== 'active') return false
  if (!row.current_period_end) return true
  const end = new Date(row.current_period_end).getTime()
  if (!Number.isFinite(end)) return false
  const clock = now instanceof Date ? now.getTime() : new Date(now).getTime()
  return end > clock
}

/** Stored rows: keep only offered types. Unknown values are ignored on read. */
export function filterPreferredCarTypes(raw) {
  const list = Array.isArray(raw) ? raw : []
  const ids = []
  for (const item of list) {
    const tier = String(item ?? '').trim().toLowerCase()
    if (!isOfferedRideTier(tier) || isBlockedRideTier(tier) || ids.includes(tier)) continue
    ids.push(tier)
  }
  return ids
}

/** Writes: anything outside the three offered types is rejected. */
export function assertPreferredCarTypes(raw) {
  const list = Array.isArray(raw) ? raw : []
  for (const item of list) {
    const tier = String(item ?? '').trim().toLowerCase()
    if (!tier) continue
    if (!isOfferedRideTier(tier) || isBlockedRideTier(tier)) {
      const error = new Error('Preferred ride types are Standard, Wait & Save, and Extra Comfort.')
      error.status = 400
      error.code = 'ride_option_unavailable'
      throw error
    }
  }
  return filterPreferredCarTypes(list)
}

/**
 * Percent off a fare that already includes the student discount.
 * A zero rate returns the same object. Deposit is recomputed from the new fare
 * when the ride already had a deposit.
 */
export function applyTigerPassDiscount(priced, bps = 0) {
  const rate = Math.max(0, Math.round(Number(bps) || 0))
  if (!rate || !priced || priced.tigerPassApplied) return priced
  const before = Math.max(0, Math.round(Number(priced.fareCents) || 0))
  const off = percentOffCents(before, rate)
  const fareCents = off.amountCents
  const hadDeposit = Math.round(Number(priced.depositCents) || 0) > 0
  const depositCents = hadDeposit ? cardDepositCents(fareCents) : 0
  const split = splitPlatformFee(fareCents)
  const previous = priced.breakdown && typeof priced.breakdown === 'object' ? priced.breakdown : {}
  const quote = priced.quote && typeof priced.quote === 'object' ? { ...priced.quote } : null
  if (quote) {
    quote.fareBeforeCreditsCents = fareCents
    quote.fareCents = fareCents
    if (quote.breakdown && typeof quote.breakdown === 'object') {
      quote.breakdown = {
        ...quote.breakdown,
        tiger_pass_name: TIGER_PASS_NAME,
        tiger_pass_discount_bps: rate,
        tiger_pass_discount_cents: off.discountCents,
        fare_before_credits_cents: fareCents,
        rider_pays_cents: fareCents,
      }
    }
  }
  return {
    ...priced,
    fareCents,
    depositCents,
    tigerPassApplied: true,
    tigerPassName: TIGER_PASS_NAME,
    tigerPassDiscountBps: rate,
    tigerPassDiscountCents: off.discountCents,
    quote: quote || priced.quote,
    breakdown: {
      ...previous,
      tiger_pass_name: TIGER_PASS_NAME,
      tiger_pass_discount_bps: rate,
      tiger_pass_discount_cents: off.discountCents,
      fare_before_tiger_pass_cents: before,
      fare_before_credits_cents: fareCents,
      rider_pays_cents: fareCents,
      platform_fee_cents: split.platformFeeCents,
      driver_earnings_cents: split.driverEarningsCents,
    },
  }
}

export function tigerPassQuoteFields(priced) {
  return {
    tigerPassName: priced?.tigerPassName || TIGER_PASS_NAME,
    tigerPassApplied: Boolean(priced?.tigerPassApplied),
    tigerPassDiscountBps: Math.max(0, Math.round(Number(priced?.tigerPassDiscountBps) || 0)),
    tigerPassDiscountCents: Math.max(0, Math.round(Number(priced?.tigerPassDiscountCents) || 0)),
  }
}

export function tigerPassMetadata(priced) {
  if (!priced?.tigerPassApplied) return {}
  return {
    tiger_pass_name: priced.tigerPassName || TIGER_PASS_NAME,
    tiger_pass_discount_bps: Math.max(0, Math.round(Number(priced.tigerPassDiscountBps) || 0)),
    tiger_pass_discount_cents: Math.max(0, Math.round(Number(priced.tigerPassDiscountCents) || 0)),
  }
}
