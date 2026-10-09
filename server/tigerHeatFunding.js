/**
 * Decoupled Tiger Heat funding.
 *
 * Rider fare is whatever the existing fare card already charged. Driver pay
 * starts from that same 80/20 split, then adds a flat Tiger Heat bonus and a
 * flat duration adjustment. Neither number changes the rider fare.
 *
 * When driver earnings exceed the rider charge, the platform fee on that
 * ride is $0. The gap (driver pay − rider charge) is the platform-funded
 * amount — the same role as Lyft's "Cost to Lyft" on a Turbo + time receipt.
 *
 * Solvency is cumulative, not per ride in isolation:
 *   revenue = rider fares − insurance − taxes
 *   margin  = revenue − driver pay (base + bonus + duration)
 * A bonus is reduced or the zone is dropped before commit when the projected
 * margin would fall below max(min dollars, min percent of revenue).
 *
 * Defaults: 5% of cumulative revenue, $0 absolute floor, insurance 0, tax 0.
 * Env vars set the deploy knob. A tiger_heat_config row overrides the env
 * (admin override).
 */

import { splitPlatformFee } from '../src/lib/fareRates.js'

export const DEFAULT_TIGER_HEAT_CONFIG = {
  minMarginCents: 0,
  minMarginBps: 500,
  insuranceBps: 0,
  taxBps: 0,
  referenceFareCents: 1798,
}

function nonNegInt(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.round(n))
}

function pickConfig(envValue, rowValue, fallback) {
  if (rowValue != null && rowValue !== '') {
    const n = Number(rowValue)
    if (Number.isFinite(n)) return n
  }
  if (envValue != null && envValue !== '') {
    const n = Number(envValue)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

export function resolveTigerHeatConfig(env = process.env, row = null) {
  return {
    minMarginCents: nonNegInt(pickConfig(env?.TIGER_HEAT_MIN_MARGIN_CENTS, row?.min_margin_cents, DEFAULT_TIGER_HEAT_CONFIG.minMarginCents), 0),
    minMarginBps: nonNegInt(pickConfig(env?.TIGER_HEAT_MIN_MARGIN_BPS, row?.min_margin_bps, DEFAULT_TIGER_HEAT_CONFIG.minMarginBps), 500),
    insuranceBps: nonNegInt(pickConfig(env?.TIGER_HEAT_INSURANCE_BPS, row?.insurance_bps, 0), 0),
    taxBps: nonNegInt(pickConfig(env?.TIGER_HEAT_TAX_BPS, row?.tax_bps, 0), 0),
    referenceFareCents: nonNegInt(
      pickConfig(env?.TIGER_HEAT_REFERENCE_FARE_CENTS, row?.reference_fare_cents, DEFAULT_TIGER_HEAT_CONFIG.referenceFareCents),
      DEFAULT_TIGER_HEAT_CONFIG.referenceFareCents,
    ),
  }
}

export function logSolvencyThrottle(details) {
  console.warn(JSON.stringify({
    level: 'warn',
    msg: 'tiger_heat_solvency_throttle',
    at: new Date().toISOString(),
    ...details,
  }))
}

/**
 * Rider fare stays put. Driver base defaults to the existing 80% net and can
 * be passed explicitly when a settlement is already decoupled.
 */
export function settleDecoupledFare({
  riderFareCents,
  driverBaseCents = null,
  bonusCents = 0,
  insuranceBps = 0,
  taxBps = 0,
} = {}) {
  const rider = Math.max(0, Math.round(Number(riderFareCents) || 0))
  const split = splitPlatformFee(rider)
  const base = driverBaseCents == null
    ? split.driverEarningsCents
    : Math.max(0, Math.round(Number(driverBaseCents) || 0))
  const bonus = Math.max(0, Math.round(Number(bonusCents) || 0))
  const driverEarnings = base + bonus
  const insurance = Math.round((rider * Math.max(0, Math.round(Number(insuranceBps) || 0))) / 10000)
  const tax = Math.round((rider * Math.max(0, Math.round(Number(taxBps) || 0))) / 10000)
  const exceeds = driverEarnings > rider
  const platformFee = exceeds ? 0 : rider - driverEarnings
  const platformFunded = exceeds ? driverEarnings - rider : 0
  const revenue = rider - insurance - tax
  return {
    riderFareCents: rider,
    driverBaseCents: base,
    bonusCents: bonus,
    driverEarningsCents: driverEarnings,
    platformFeeCents: platformFee,
    platformFundedCents: platformFunded,
    costToPlatformCents: platformFunded,
    insuranceCents: insurance,
    taxCents: tax,
    revenueCents: revenue,
    marginDeltaCents: revenue - driverEarnings,
    platformFeeWaived: exceeds,
  }
}

export function requiredFloorCents(revenueCents, config) {
  const revenue = Math.max(0, Math.round(Number(revenueCents) || 0))
  const pct = Math.round((revenue * Math.max(0, Math.round(Number(config?.minMarginBps) || 0))) / 10000)
  return Math.max(Math.max(0, Math.round(Number(config?.minMarginCents) || 0)), pct)
}

/**
 * Largest whole-dollar bonus that keeps cumulative margin at or above the floor
 * after this trip's revenue, insurance, tax, and driver base are counted.
 */
export function maxAffordableBonusCents({
  ledger,
  config,
  riderFareCents,
  driverBaseCents = null,
}) {
  const probe = settleDecoupledFare({
    riderFareCents,
    driverBaseCents,
    bonusCents: 0,
    insuranceBps: config?.insuranceBps,
    taxBps: config?.taxBps,
  })
  const revenueAfter = Math.max(0, Math.round(Number(ledger?.revenueCents) || 0)) + probe.revenueCents
  const floor = requiredFloorCents(revenueAfter, config)
  const margin = Math.round(Number(ledger?.marginCents) || 0)
  const room = margin + probe.revenueCents - probe.driverBaseCents - floor
  if (room < 100) return 0
  return Math.floor(room / 100) * 100
}

export function throttleBonus({
  requestedCents,
  ledger,
  config,
  riderFareCents,
  driverBaseCents = null,
  zoneId = null,
  stage = 'commit',
}) {
  const requested = Math.max(0, Math.round(Number(requestedCents) || 0))
  const affordable = maxAffordableBonusCents({ ledger, config, riderFareCents, driverBaseCents })
  const granted = Math.min(requested, affordable)
  const throttled = granted < requested
  const probe = settleDecoupledFare({
    riderFareCents,
    driverBaseCents,
    bonusCents: 0,
    insuranceBps: config?.insuranceBps,
    taxBps: config?.taxBps,
  })
  const revenueAfter = Math.max(0, Math.round(Number(ledger?.revenueCents) || 0)) + probe.revenueCents
  const floorCents = requiredFloorCents(revenueAfter, config)
  if (throttled) {
    logSolvencyThrottle({
      stage,
      zoneId,
      requestedCents: requested,
      grantedCents: granted,
      deactivated: granted <= 0,
      marginCents: Math.round(Number(ledger?.marginCents) || 0),
      floorCents,
      revenueCents: Math.round(Number(ledger?.revenueCents) || 0),
      driverPayCents: Math.round(Number(ledger?.driverPayCents) || 0),
      reason: granted <= 0 ? 'deactivated' : 'reduced',
    })
  }
  return {
    requestedCents: requested,
    grantedCents: granted,
    throttled,
    deactivated: granted <= 0 && requested > 0,
    floorCents,
    marginCents: Math.round(Number(ledger?.marginCents) || 0),
  }
}
