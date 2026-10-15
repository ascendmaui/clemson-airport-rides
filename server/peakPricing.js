/**
 * Server side of peak pricing. Feature flag PEAK_PRICING_ENABLED, default OFF.
 *
 * Flag OFF: nothing here changes a price or a payout. Fares keep the legacy
 * resolveSurge multipliers in src/lib/fareRates.js.
 * Flag ON: the peak surcharge (shared/peakPricing.js) replaces the legacy
 * multiplier, completed peak trips settle the higher driver cut plus a pool
 * bonus, and completed regular trips contribute to the pool.
 *
 * Pool money lives in public.peak_pool_ledger and moves only through the
 * peak_pool_contribute / peak_pool_draw functions (service_role only). The
 * draw function locks and caps the grant at the balance, so the pool cannot go
 * negative even with concurrent settles on several instances. When those
 * functions are missing (migration not applied) the bonus is $0: fail closed.
 *
 * Bonuses are part of the trip's driver net, so they reach Stripe only through
 * the payout queue and the admin approval flow (#554).
 */
import {
  PEAK_PRICING_VERSION,
  detectPeak,
  normalizePeakConfig,
  peakDriverLine,
  peakRiderLine,
  planPeakTrip,
  poolContributionCents,
  surchargeBpsFor,
} from '../shared/peakPricing.js'

const ON = new Set(['1', 'true', 'on', 'yes'])

export function peakPricingEnabled(env = process.env) {
  return ON.has(String(env?.PEAK_PRICING_ENABLED ?? '').trim().toLowerCase())
}

/** Optional JSON override of PEAK_DEFAULTS (PEAK_PRICING_CONFIG). Bad JSON is ignored. */
export function peakConfigFromEnv(env = process.env) {
  const raw = env?.PEAK_PRICING_CONFIG
  if (!raw || !String(raw).trim()) return normalizePeakConfig(null)
  try {
    return normalizePeakConfig(JSON.parse(String(raw)))
  } catch {
    return normalizePeakConfig(null)
  }
}

/**
 * Surge mode for the fare engine.
 *   { kind: 'legacy' }            flag off: resolveSurge multipliers, unchanged
 *   { kind: 'none' }              flag on, no peak right now: no surcharge
 *   { kind: 'peak', peak, bps }   flag on and a peak reason applies
 * scheduled rides never surge by default (surgeScheduled: false).
 * gameDayMultiplier is what loadGameDayMultiplier returned: null means no live
 * game_day_events row; any number (even 0 for a NULL column) means one is live.
 */
export function peakSurgeMode({ at = new Date(), airport = false, scheduled = false, gameDayMultiplier = null, env = process.env } = {}) {
  if (!peakPricingEnabled(env)) return { kind: 'legacy' }
  const config = peakConfigFromEnv(env)
  const gameDayEventActive = gameDayMultiplier != null && Number.isFinite(Number(gameDayMultiplier))
  const peak = detectPeak({ at, airport: Boolean(airport), scheduled: Boolean(scheduled), gameDayEventActive, config })
  const bps = surchargeBpsFor(peak, config)
  if (!peak.active || bps <= 0) return { kind: 'none', config }
  return { kind: 'peak', peak, bps, config }
}

/** Rider-facing quote block. Null when no surcharge applies. */
export function peakQuoteFields(priced) {
  const peak = priced?.peak
  if (!peak || !peak.surchargeBps) return null
  return {
    version: peak.version,
    surchargeBps: peak.surchargeBps,
    surchargePct: peak.surchargeBps / 100,
    surchargeCents: peak.surchargeCents,
    baseFareCents: peak.baseFareCents,
    reason: peak.reason,
    reasonLabel: peak.reasonLabel,
    reasons: peak.reasons,
    riderLine: peakRiderLine({ reasonLabel: peak.reasonLabel, surchargeBps: peak.surchargeBps, surchargeCents: peak.surchargeCents }),
  }
}

/** Public status for the driver home (Busy areas strip, Before you go online). */
export function peakStatus({ at = new Date(), env = process.env } = {}) {
  if (!peakPricingEnabled(env)) return { enabled: false, active: false }
  const config = peakConfigFromEnv(env)
  const campus = detectPeak({ at, airport: false, config })
  const airport = detectPeak({ at, airport: true, config })
  const top = airport.primary && (!campus.primary || airport.primary.bps > campus.primary.bps) ? airport : campus
  const active = Boolean(campus.active || airport.active)
  return {
    enabled: true,
    active,
    reason: top.primary?.id || null,
    reasonLabel: top.primary?.label || null,
    campusSurchargeBps: surchargeBpsFor(campus, config),
    airportSurchargeBps: surchargeBpsFor(airport, config),
    reasons: [...new Set([...campus.reasons, ...airport.reasons].filter((r) => r.bps > 0).map((r) => r.label))],
    driverLine: peakDriverLine({ active, reasonLabel: top.primary?.label || null }),
  }
}

/** Peak keys stored in fare_breakdown on every trip row built from a quote. */
export function readTripPeak(trip) {
  const b = trip?.fare_breakdown && typeof trip.fare_breakdown === 'object' ? trip.fare_breakdown : {}
  const bps = Math.max(0, Math.round(Number(b.peak_surcharge_bps) || 0))
  if (!bps) return null
  const cents = (v) => {
    const n = Number(v)
    return v != null && v !== '' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : null
  }
  return {
    surchargeBps: bps,
    baseFareCents: cents(b.peak_base_fare_cents),
    payBaseCents: cents(b.peak_pay_base_cents),
    payPeakCents: cents(b.peak_pay_peak_cents),
    reason: typeof b.peak_reason === 'string' ? b.peak_reason : null,
  }
}

function shareBpsOf(trip, fallback) {
  const meta = trip?.metadata || {}
  for (const raw of [meta.driver_share_bps, meta.offer_share_bps]) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0 && n <= 10000) return Math.round(n)
  }
  return fallback
}

async function rpc(sb, name, args) {
  if (!sb || typeof sb.rpc !== 'function') return { data: null, error: { message: 'rpc_unavailable' } }
  try {
    const result = await sb.rpc(name, args)
    return result || { data: null, error: { message: 'rpc_empty' } }
  } catch (error) {
    return { data: null, error: { message: error?.message || String(error) } }
  }
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] || null : data
}

export async function peakPoolBalance(sb) {
  const { data, error } = await rpc(sb, 'peak_pool_balance', {})
  if (error) return null
  const n = Number(firstRow(data)?.balance_cents ?? firstRow(data))
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null
}

/**
 * Settle a completed trip under peak pricing. Returns the metadata block to
 * store at trip.metadata.peak_pricing, or null when there is nothing to do.
 *   peak trip:    plan the higher cut and pool bonus, draw the bonus atomically
 *   regular trip: record the pool contribution (idempotent per trip)
 */
export async function settlePeakPricing({ sb, trip, env = process.env, now = new Date() } = {}) {
  if (!peakPricingEnabled(env) || !trip?.id) return null
  if (trip?.metadata?.e2e_test === true || trip?.metadata?.e2e_test === 'true') return null
  if (trip?.metadata?.peak_pricing?.settled) return trip.metadata.peak_pricing
  const config = peakConfigFromEnv(env)
  const fare = Math.max(0, Math.round(Number(trip.fare_cents) || 0))
  const peak = readTripPeak(trip)

  if (!peak) {
    const balance = await peakPoolBalance(sb)
    const cents = poolContributionCents({ fareCents: fare, peak: false, poolBalanceCents: balance ?? 0, config })
    if (cents <= 0) return null
    const { data, error } = await rpc(sb, 'peak_pool_contribute', {
      p_trip_id: trip.id,
      p_amount_cents: cents,
      p_ceiling_cents: config.poolCeilingCents,
    })
    const recorded = error ? 0 : Math.max(0, Math.round(Number(firstRow(data)?.recorded_cents ?? firstRow(data)) || 0))
    return {
      version: PEAK_PRICING_VERSION,
      kind: 'contribution',
      settled: true,
      contributionCents: recorded,
      at: now.toISOString(),
      ...(error ? { error: 'pool_unavailable' } : {}),
    }
  }

  const baseFare = peak.baseFareCents ?? fare
  const shareBps = shareBpsOf(trip, config.baseShareBps)
  // Plan with the requested bonus first, then let the database grant what the pool holds.
  const basis = { baseFareCents: baseFare, riderFareCents: fare, payBaseCents: peak.payBaseCents, payPeakCents: peak.payPeakCents, baseShareBps: shareBps, config }
  const requested = planPeakTrip({ ...basis, poolBalanceCents: Number.MAX_SAFE_INTEGER })
  let granted = 0
  let poolError = null
  if (requested.bonusCents > 0) {
    const { data, error } = await rpc(sb, 'peak_pool_draw', {
      p_trip_id: trip.id,
      p_driver_id: trip.driver_id || null,
      p_requested_cents: requested.bonusCents,
    })
    if (error) poolError = 'pool_unavailable'
    else granted = Math.max(0, Math.round(Number(firstRow(data)?.granted_cents ?? firstRow(data)) || 0))
  }
  const plan = planPeakTrip({ ...basis, poolBalanceCents: granted })
  return {
    version: PEAK_PRICING_VERSION,
    kind: 'peak',
    settled: true,
    reason: peak.reason,
    surchargeBps: peak.surchargeBps,
    baseFareCents: plan.baseFareCents,
    riderFareCents: plan.riderFareCents,
    surchargeCents: plan.surchargeCents,
    payBaseCents: plan.payBaseCents,
    payPeakCents: plan.payPeakCents,
    baseShareBps: plan.baseShareBps,
    offPeakPayCents: plan.offPeakPayCents,
    peakCutPayCents: plan.peakCutPayCents,
    cutBps: plan.cutBps,
    bonusRequestedCents: requested.bonusCents,
    bonusDrawnCents: granted,
    bonusCents: plan.bonusCents,
    driverEarningsCents: plan.driverTotalCents,
    platformTakeCents: plan.platformTakeCents,
    platformDeltaCents: plan.platformDeltaCents,
    upliftBps: plan.upliftBps,
    guardrails: plan.guardrails,
    at: now.toISOString(),
    ...(poolError ? { error: poolError } : {}),
  }
}
