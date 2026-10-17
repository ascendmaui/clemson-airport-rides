/**
 * Per-fare profit margin (John's 2026-10-17 rule: the system must always
 * generate profit; target margin defaults to 15%).
 *
 *   margin = (riderFare - driverPayout - stripeFee - overhead) / riderFare
 *   stripeFee = round(riderFare * stripeFeeBps / 10000) + stripeFixedCents   (card: 2.9% + $0.30)
 *   overhead  = overheadCents / overheadSeats                                 (default $0.75 per ride)
 *
 * Driver payout today is the existing split: driver = fare - round(fare * 20%)
 * (src/lib/fareRates.js splitPlatformFee), i.e. 80% of what the rider pays.
 * With an 80% driver share and 2.9% Stripe, the margin can never exceed
 * 17.1%, and a 15% target needs a fare of at least
 * (30 + 75) / (1 - 0.80 - 0.029 - 0.15) = ~$50. See docs/pricing-competitor-check.md.
 *
 * Carpool: each seat is its own card charge (Stripe fixed fee per seat). The
 * per-ride overhead is charged in full to each seat unless
 * carpoolOverheadSeats > 1 (conservative default 1).
 */
export const MARGIN_DEFAULTS = Object.freeze({
  targetMarginBps: 1500,
  stripeFeeBps: 290,
  stripeFixedCents: 30,
  overheadCents: 75,
  carpoolOverheadSeats: 1,
  driverShareBps: 8000,
})

function int(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

export function normalizeMarginSettings(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const d = MARGIN_DEFAULTS
  const clamp = (v, lo, hi, f) => Math.min(hi, Math.max(lo, int(v, f)))
  return {
    targetMarginBps: clamp(c.targetMarginBps, 0, 9000, d.targetMarginBps),
    stripeFeeBps: clamp(c.stripeFeeBps, 0, 1000, d.stripeFeeBps),
    stripeFixedCents: clamp(c.stripeFixedCents, 0, 500, d.stripeFixedCents),
    overheadCents: clamp(c.overheadCents, 0, 2000, d.overheadCents),
    carpoolOverheadSeats: clamp(c.carpoolOverheadSeats, 1, 6, d.carpoolOverheadSeats),
    driverShareBps: clamp(c.driverShareBps, 0, 10000, d.driverShareBps),
  }
}

/** Driver payout under the existing 80/20 split (platform fee rounds, driver gets the rest). */
export function driverPayoutCents(fareCents, driverShareBps = MARGIN_DEFAULTS.driverShareBps) {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  const platform = Math.round((fare * (10000 - driverShareBps)) / 10000)
  return fare - platform
}

export function stripeFeeCents(fareCents, settings = MARGIN_DEFAULTS) {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  if (fare <= 0) return 0
  return Math.round((fare * settings.stripeFeeBps) / 10000) + settings.stripeFixedCents
}

/**
 * Margin of one rider charge. driverPayout defaults to the 80% split.
 * carpool: true spreads overhead over carpoolOverheadSeats.
 */
export function fareMargin({ fareCents, driverPayout = null, carpool = false, settings = null } = {}) {
  const s = normalizeMarginSettings(settings)
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  const driver = driverPayout == null ? driverPayoutCents(fare, s.driverShareBps) : Math.max(0, Math.round(Number(driverPayout) || 0))
  const stripe = stripeFeeCents(fare, s)
  const overhead = Math.round(s.overheadCents / (carpool ? s.carpoolOverheadSeats : 1))
  const profit = fare - driver - stripe - overhead
  const marginBps = fare > 0 ? Math.floor((profit * 10000) / fare) : -10000
  return {
    fareCents: fare,
    driverPayoutCents: driver,
    stripeFeeCents: stripe,
    overheadCents: overhead,
    profitCents: profit,
    marginBps,
    targetBps: s.targetMarginBps,
    belowTarget: marginBps < s.targetMarginBps,
    unprofitable: profit < 0,
  }
}

/**
 * Smallest fare (cents) that reaches targetBps with the current driver share.
 * Null when the target is unreachable at any fare (share + Stripe % + target >= 100%).
 */
export function minFareForMargin({ targetBps = null, carpool = false, settings = null } = {}) {
  const s = normalizeMarginSettings(settings)
  const target = targetBps == null ? s.targetMarginBps : targetBps
  const overhead = Math.round(s.overheadCents / (carpool ? s.carpoolOverheadSeats : 1))
  const room = 10000 - s.driverShareBps - s.stripeFeeBps - target
  if (room <= 0) return null
  let fare = Math.ceil(((s.stripeFixedCents + overhead) * 10000) / room)
  // Integer rounding in the split/fee can shave a cent; walk up until it truly clears.
  for (let i = 0; i < 50 && fareMargin({ fareCents: fare, carpool, settings: { ...s, targetMarginBps: target } }).belowTarget; i += 1) fare += 1
  return fare
}
