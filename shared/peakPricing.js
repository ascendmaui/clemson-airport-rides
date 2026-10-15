/**
 * Peak pricing (surge) for Clemson Rides. Pure functions only: no I/O, no
 * clock reads unless `at` is omitted, integer cents everywhere.
 *
 * During a peak window:
 *   1. The rider pays a surcharge on top of the fare (surchargeBps, capped).
 *   2. The driver keeps a higher cut: their normal share of the base fare plus
 *      SURCHARGE_DRIVER_SHARE of the surcharge dollars.
 *   3. A small pool bonus tops the driver up toward TARGET_UPLIFT over the
 *      pay they would have earned on the same trip off-peak. The bonus is
 *      capped (modest) and can never exceed the pool balance.
 * Outside peak, every regular completed ride sends POOL_CONTRIBUTION_BPS of its
 * fare (out of the platform fee, never the driver's share or a rider add-on)
 * into the pool.
 *
 * Guardrail on every surged trip:
 *   rider surcharge + pool draw >= extra driver pay (vs off-peak), so the
 *   platform keeps at least what it would have kept off-peak; the pool draw is
 *   <= the pool balance; driver uplift stays inside the 25-50% band ceiling.
 *
 * "Typical hourly rate": the same trip takes the same minutes peak or not, so
 * a per-trip uplift of X% is an X% uplift in hourly pay for that trip time.
 * The baseline is what the driver would earn on this exact trip off-peak.
 *
 * The full math with worked examples is in docs/PEAK_PRICING.md.
 */
import { CLEMSON_HOME_FOOTBALL } from './data/clemsonHomeFootball.js'
import { zonedCivilToUtc } from './rideTime.js'

export const PEAK_PRICING_VERSION = '2026-10-15'
export const PEAK_TIME_ZONE = 'America/New_York'

export const PEAK_DEFAULTS = Object.freeze({
  /** Driver share of the fare off-peak (80% = platform fee 20%). */
  baseShareBps: 8000,
  /**
   * Surcharge percent per peak reason. Highest reason wins; reasons do not stack.
   * Defaults follow the 2026-10-15 pricing research (pending John's approval):
   * game day 1.5x on real home games only, airport rush 1.10x on-demand only,
   * no weekend surcharge (weekend nights are still detected, at 0%).
   */
  reasonBps: Object.freeze({ game_day: 5000, airport_rush: 1000, weekend_night: 0 }),
  /** Hard caps on the rider surcharge: 1.75x (research SURGE_MAX) and $25 per trip. */
  maxSurchargeBps: 7500,
  maxSurchargeCents: 2500,
  /** Scheduled rides never surge (research). Their fare is locked when booked. */
  surgeScheduled: false,
  /** Driver pay is figured on the pre-discount fare, so promos never cut driver pay. */
  driverPayBasis: 'pre_discount',
  /** Driver keeps this share of every surcharge dollar. The rest covers card fees on the extra charge. */
  surchargeDriverShareBps: 9000,
  /** Absolute ceiling on the driver cut of the rider price during peak. */
  maxDriverCutBps: 8800,
  /** Pool bonus aims total driver pay at +30% vs the off-peak pay for the trip. */
  targetUpliftBps: 3000,
  /** The band John set: 25% to 50% above typical. */
  bandFloorBps: 2500,
  bandCeilingBps: 5000,
  /** Bonus is "a little extra": at most 15% of off-peak pay and $10 per trip. */
  maxBonusShareBps: 1500,
  maxBonusCents: 1000,
  /** Regular (non-peak) completed rides contribute 2% of the fare from the platform fee. */
  poolContributionBps: 200,
  /** Contributions pause while the pool holds this much. */
  poolCeilingCents: 100000,
  /** Weekend nights: Friday and Saturday 22:00 to 02:00 ET (wraps past midnight). */
  weekendNights: Object.freeze({ days: Object.freeze([5, 6]), startMin: 22 * 60, endMin: 2 * 60 }),
  /** Airport rush windows on on-demand airport trips (same windows as the legacy rule). */
  airportRush: Object.freeze([
    Object.freeze({ startMin: 5 * 60, endMin: 8 * 60 }),
    Object.freeze({ startMin: 15 * 60, endMin: 19 * 60 }),
  ]),
  /** Game day window around kickoff (arrivals through late exits). */
  gameDayBeforeMin: 180,
  gameDayAfterMin: 380,
  /** TBA kickoff: 10:00 to 24:00 ET on game day. */
  gameDayTbaStartMin: 10 * 60,
  gameDayTbaEndMin: 24 * 60,
})

export const PEAK_REASON_LABELS = Object.freeze({
  game_day: 'Game day',
  airport_rush: 'Airport rush',
  weekend_night: 'Weekend night',
})

const BPS = 10000
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function int(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

function nonNeg(value, fallback = 0) {
  return Math.max(0, int(value, fallback))
}

function clampBps(value, fallback) {
  return Math.max(0, Math.min(BPS, int(value, fallback)))
}

/** Merge an override (env JSON or admin config) onto the defaults, clamped. */
export function normalizePeakConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const d = PEAK_DEFAULTS
  const reasons = c.reasonBps && typeof c.reasonBps === 'object' ? c.reasonBps : {}
  const maxSurchargeBps = clampBps(c.maxSurchargeBps, d.maxSurchargeBps)
  const config = {
    baseShareBps: clampBps(c.baseShareBps, d.baseShareBps),
    reasonBps: {
      game_day: Math.min(maxSurchargeBps, clampBps(reasons.game_day, d.reasonBps.game_day)),
      airport_rush: Math.min(maxSurchargeBps, clampBps(reasons.airport_rush, d.reasonBps.airport_rush)),
      weekend_night: Math.min(maxSurchargeBps, clampBps(reasons.weekend_night, d.reasonBps.weekend_night)),
    },
    maxSurchargeBps,
    maxSurchargeCents: nonNeg(c.maxSurchargeCents, d.maxSurchargeCents),
    surgeScheduled: c.surgeScheduled == null ? d.surgeScheduled : c.surgeScheduled === true,
    driverPayBasis: c.driverPayBasis === 'rider_paid' ? 'rider_paid' : d.driverPayBasis,
    // A driver share under 100% of the base share would cut the driver; keep it in [base, 100%].
    surchargeDriverShareBps: clampBps(c.surchargeDriverShareBps, d.surchargeDriverShareBps),
    maxDriverCutBps: clampBps(c.maxDriverCutBps, d.maxDriverCutBps),
    targetUpliftBps: nonNeg(c.targetUpliftBps, d.targetUpliftBps),
    bandFloorBps: nonNeg(c.bandFloorBps, d.bandFloorBps),
    bandCeilingBps: nonNeg(c.bandCeilingBps, d.bandCeilingBps),
    maxBonusShareBps: clampBps(c.maxBonusShareBps, d.maxBonusShareBps),
    maxBonusCents: nonNeg(c.maxBonusCents, d.maxBonusCents),
    poolContributionBps: Math.min(1000, clampBps(c.poolContributionBps, d.poolContributionBps)),
    poolCeilingCents: nonNeg(c.poolCeilingCents, d.poolCeilingCents),
    weekendNights: c.weekendNights && Array.isArray(c.weekendNights.days)
      ? {
          days: c.weekendNights.days.map((n) => int(n, -1)).filter((n) => n >= 0 && n <= 6),
          startMin: nonNeg(c.weekendNights.startMin, d.weekendNights.startMin),
          endMin: nonNeg(c.weekendNights.endMin, d.weekendNights.endMin),
        }
      : { ...d.weekendNights, days: [...d.weekendNights.days] },
    airportRush: Array.isArray(c.airportRush)
      ? c.airportRush.map((w) => ({ startMin: nonNeg(w?.startMin), endMin: nonNeg(w?.endMin) })).filter((w) => w.endMin > w.startMin)
      : d.airportRush.map((w) => ({ ...w })),
    gameDayBeforeMin: nonNeg(c.gameDayBeforeMin, d.gameDayBeforeMin),
    gameDayAfterMin: nonNeg(c.gameDayAfterMin, d.gameDayAfterMin),
    gameDayTbaStartMin: nonNeg(c.gameDayTbaStartMin, d.gameDayTbaStartMin),
    gameDayTbaEndMin: nonNeg(c.gameDayTbaEndMin, d.gameDayTbaEndMin),
  }
  if (config.surchargeDriverShareBps < config.baseShareBps) config.surchargeDriverShareBps = config.baseShareBps
  if (config.maxDriverCutBps < config.baseShareBps) config.maxDriverCutBps = config.baseShareBps
  if (config.bandCeilingBps < config.bandFloorBps) config.bandCeilingBps = config.bandFloorBps
  config.targetUpliftBps = Math.min(config.bandCeilingBps, Math.max(config.bandFloorBps, config.targetUpliftBps))
  return config
}

export function zonedClock(date, timeZone = PEAK_TIME_ZONE) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  return {
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  }
}

function inWindow(minutes, w) {
  return minutes >= w.startMin && minutes < w.endMin
}

/** Friday or Saturday night, 21:00-03:00 ET. 01:30 Sunday counts as Saturday night. */
export function isWeekendNight(at, config = PEAK_DEFAULTS) {
  const when = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(when.getTime())) return false
  const { days, startMin, endMin } = config.weekendNights
  const clock = zonedClock(when)
  if (startMin <= endMin) return days.includes(clock.weekday) && clock.minutes >= startMin && clock.minutes < endMin
  if (days.includes(clock.weekday) && clock.minutes >= startMin) return true
  const prevDay = (clock.weekday + 6) % 7
  return days.includes(prevDay) && clock.minutes < endMin
}

export function isAirportRush(at, airport, config = PEAK_DEFAULTS) {
  if (!airport) return false
  const when = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(when.getTime())) return false
  const clock = zonedClock(when)
  return config.airportRush.some((w) => inWindow(clock.minutes, w))
}

/** Peak window [start, end) in UTC ms for one scheduled home game. */
export function gameDayWindow(game, config = PEAK_DEFAULTS) {
  if (!game?.date || !/^\d{4}-\d{2}-\d{2}$/.test(game.date)) return null
  const [y, m, d] = game.date.split('-').map(Number)
  const kick = typeof game.kickoffEt === 'string' && /^\d{2}:\d{2}$/.test(game.kickoffEt) ? game.kickoffEt : null
  if (kick) {
    const [hh, mm] = kick.split(':').map(Number)
    const kickoff = zonedCivilToUtc(y, m, d, hh, mm, 0, PEAK_TIME_ZONE)
    if (Number.isNaN(kickoff.getTime())) return null
    return {
      startMs: kickoff.getTime() - config.gameDayBeforeMin * 60_000,
      endMs: kickoff.getTime() + config.gameDayAfterMin * 60_000,
      kickoffMs: kickoff.getTime(),
    }
  }
  const dayStart = zonedCivilToUtc(y, m, d, 0, 0, 0, PEAK_TIME_ZONE)
  if (Number.isNaN(dayStart.getTime())) return null
  return {
    startMs: dayStart.getTime() + config.gameDayTbaStartMin * 60_000,
    endMs: dayStart.getTime() + config.gameDayTbaEndMin * 60_000,
    kickoffMs: null,
  }
}

/** The scheduled home game whose window covers `at`, if any. */
export function scheduledGameAt(at, schedule = CLEMSON_HOME_FOOTBALL, config = PEAK_DEFAULTS) {
  const t = (at instanceof Date ? at : new Date(at)).getTime()
  if (!Number.isFinite(t)) return null
  for (const game of schedule || []) {
    const w = gameDayWindow(game, config)
    if (w && t >= w.startMs && t < w.endMs) return { ...game, ...w }
  }
  return null
}

/**
 * Which peak reasons apply at `at`.
 *   gameDayEventActive: a public.game_day_events row overlaps `at` (any multiplier).
 *   airport: the trip starts or ends at GSP/CLT/ATL.
 *   scheduled: a ride booked ahead. Scheduled rides never surge unless surgeScheduled.
 * A reason at 0% is listed but does not make the window active.
 */
export function detectPeak({
  at = new Date(),
  airport = false,
  scheduled = false,
  gameDayEventActive = false,
  schedule = CLEMSON_HOME_FOOTBALL,
  config: rawConfig = null,
} = {}) {
  const config = normalizePeakConfig(rawConfig)
  const when = at instanceof Date ? at : new Date(at)
  const reasons = []
  if (scheduled && !config.surgeScheduled) return { active: false, reasons, primary: null, scheduledExempt: true }
  const game = Number.isNaN(when.getTime()) ? null : scheduledGameAt(when, schedule, config)
  if (game || gameDayEventActive) {
    reasons.push({
      id: 'game_day',
      label: PEAK_REASON_LABELS.game_day,
      bps: config.reasonBps.game_day,
      source: game ? 'schedule' : 'game_day_events',
      ...(game ? { opponent: game.opponent } : {}),
    })
  }
  if (isAirportRush(when, airport, config)) {
    reasons.push({ id: 'airport_rush', label: PEAK_REASON_LABELS.airport_rush, bps: config.reasonBps.airport_rush })
  }
  if (isWeekendNight(when, config)) {
    reasons.push({ id: 'weekend_night', label: PEAK_REASON_LABELS.weekend_night, bps: config.reasonBps.weekend_night })
  }
  reasons.sort((a, b) => b.bps - a.bps)
  const active = reasons.some((r) => r.bps > 0)
  return { active, reasons, primary: active ? reasons[0] : null }
}

/** Surcharge percent in basis points: highest reason, capped at maxSurchargeBps. */
export function surchargeBpsFor(peak, rawConfig = null) {
  const config = normalizePeakConfig(rawConfig)
  if (!peak?.active) return 0
  const top = Math.max(0, ...(peak.reasons || []).map((r) => nonNeg(r.bps)))
  return Math.min(config.maxSurchargeBps, top)
}

/**
 * Surcharge cents on a base fare. The percent cap applies first, then the
 * dollar cap. effectiveBps is the rate actually charged after the dollar cap.
 */
export function surchargeForFare(baseFareCents, bps, rawConfig = null) {
  const config = normalizePeakConfig(rawConfig)
  const base = nonNeg(baseFareCents)
  const rate = Math.min(config.maxSurchargeBps, nonNeg(bps))
  const raw = Math.round((base * rate) / BPS)
  const surchargeCents = Math.min(raw, config.maxSurchargeCents)
  const effectiveBps = base > 0 ? Math.min(rate, Math.floor((surchargeCents * BPS) / base)) : 0
  return { baseFareCents: base, requestedBps: rate, surchargeCents, effectiveBps, dollarCapped: raw > surchargeCents }
}

/** Off-peak driver pay on a fare at a ladder share. 80% rounds like the platform fee split. */
export function sharePayCents(fareCents, shareBps) {
  const fare = nonNeg(fareCents)
  const bps = clampBps(shareBps, PEAK_DEFAULTS.baseShareBps)
  if (bps === 8000) return fare - Math.round(fare * 0.2)
  return Math.round((fare * bps) / BPS)
}

/**
 * Driver pay from the higher peak cut, before any pool bonus.
 *   pay = share x pay base + floor(surchargeDriverShare x surcharge on the pay basis)
 * The pay basis is the pre-discount fare by default, so a promo never lowers
 * driver pay. Three ceilings keep the guardrail true by construction:
 *   - the driver's surcharge dollars never exceed the surcharge the rider paid,
 *   - pay stays under maxDriverCutBps of the rider price,
 *   - pay stays under the band ceiling (+50% over off-peak pay).
 * cutBps is pay / pay basis with surcharge (the driver's cut of the fare).
 */
export function peakDriverCut({
  baseFareCents,
  riderFareCents,
  payBaseCents = null,
  payPeakCents = null,
  baseShareBps = PEAK_DEFAULTS.baseShareBps,
  config: rawConfig = null,
} = {}) {
  const config = normalizePeakConfig(rawConfig)
  const base = nonNeg(baseFareCents)
  const rider = Math.max(base, nonNeg(riderFareCents))
  const riderSurcharge = rider - base
  const payBase = payBaseCents == null ? base : nonNeg(payBaseCents)
  const payPeak = payPeakCents == null ? Math.max(payBase, payBase + riderSurcharge) : Math.max(payBase, nonNeg(payPeakCents))
  const share = clampBps(baseShareBps, config.baseShareBps)
  const offPeakPayCents = sharePayCents(payBase, share)
  const fromSurcharge = Math.min(
    riderSurcharge,
    Math.floor(((payPeak - payBase) * config.surchargeDriverShareBps) / BPS),
  )
  const uncapped = offPeakPayCents + fromSurcharge
  const ceilings = {
    cut: Math.max(offPeakPayCents, Math.floor((Math.max(rider, payPeak) * config.maxDriverCutBps) / BPS)),
    band: Math.floor((offPeakPayCents * (BPS + config.bandCeilingBps)) / BPS),
  }
  const payCents = Math.max(offPeakPayCents, Math.min(uncapped, ceilings.cut, ceilings.band))
  return {
    baseFareCents: base,
    riderFareCents: rider,
    surchargeCents: riderSurcharge,
    payBaseCents: payBase,
    payPeakCents: payPeak,
    baseShareBps: share,
    offPeakPayCents,
    surchargeToDriverCents: payCents - offPeakPayCents,
    payCents,
    cutBps: payPeak > 0 ? Math.round((payCents * BPS) / payPeak) : share,
    cutCapped: uncapped > payCents ? (uncapped > ceilings.band && ceilings.band <= ceilings.cut ? 'band' : 'cut') : null,
  }
}

/** Pool contribution from one completed regular (non-peak) ride. Zero on peak rides. */
export function poolContributionCents({ fareCents, peak = false, poolBalanceCents = 0, config: rawConfig = null } = {}) {
  const config = normalizePeakConfig(rawConfig)
  if (peak) return 0
  const raw = Math.floor((nonNeg(fareCents) * config.poolContributionBps) / BPS)
  const room = Math.max(0, config.poolCeilingCents - nonNeg(poolBalanceCents))
  return Math.min(raw, room)
}

/**
 * Pool bonus for one peak trip. Fills the gap between the higher cut and the
 * target uplift, then: <= maxBonusShareBps of off-peak pay, <= maxBonusCents,
 * <= pool balance, and never past the band ceiling.
 */
export function peakBonusCents({ offPeakPayCents, peakCutPayCents, poolBalanceCents = 0, config: rawConfig = null } = {}) {
  const config = normalizePeakConfig(rawConfig)
  const offPeak = nonNeg(offPeakPayCents)
  const cutPay = nonNeg(peakCutPayCents)
  const targetCents = Math.floor((offPeak * (BPS + config.targetUpliftBps)) / BPS)
  const ceilingCents = Math.floor((offPeak * (BPS + config.bandCeilingBps)) / BPS)
  const gapCents = Math.max(0, targetCents - cutPay)
  const limits = {
    gap: gapCents,
    share: Math.floor((offPeak * config.maxBonusShareBps) / BPS),
    perTrip: config.maxBonusCents,
    pool: nonNeg(poolBalanceCents),
    band: Math.max(0, ceilingCents - cutPay),
  }
  const bonusCents = Math.max(0, Math.min(...Object.values(limits)))
  const cappedBy = bonusCents < gapCents
    ? Object.entries(limits).filter(([key, v]) => key !== 'gap' && v === bonusCents).map(([key]) => key)
    : []
  return { bonusCents, targetCents, ceilingCents, gapCents, limits, cappedBy }
}

/**
 * Money guardrails on a planned peak trip. Every check must pass or the
 * planner drops the bonus (and, failing that, trims the cut). The rider
 * surcharge caps are enforced at pricing time by surchargeForFare.
 */
export function checkPeakGuardrails(plan, rawConfig = null) {
  const config = normalizePeakConfig(rawConfig)
  const violations = []
  const base = nonNeg(plan?.baseFareCents)
  const rider = nonNeg(plan?.riderFareCents)
  const surcharge = rider - base
  const offPeak = nonNeg(plan?.offPeakPayCents)
  const driverTotal = nonNeg(plan?.driverTotalCents)
  const bonus = nonNeg(plan?.bonusCents)
  const pool = nonNeg(plan?.poolBalanceCents)
  const extraDriverPay = driverTotal - offPeak
  if (surcharge < 0) violations.push('surcharge_negative')
  if (surcharge + bonus < extraDriverPay) violations.push('platform_loses_money')
  if (rider - (driverTotal - bonus) < base - offPeak) violations.push('platform_take_below_off_peak')
  if (rider - (driverTotal - bonus) < 0) violations.push('platform_take_negative')
  if (bonus > pool) violations.push('bonus_exceeds_pool')
  if (pool - bonus < 0) violations.push('pool_negative')
  if (offPeak > 0 && driverTotal > Math.floor((offPeak * (BPS + config.bandCeilingBps)) / BPS)) violations.push('driver_over_band_ceiling')
  if (driverTotal < offPeak) violations.push('driver_paid_less_than_off_peak')
  return { ok: violations.length === 0, violations }
}

/**
 * Full plan for one completed peak trip.
 *   baseFareCents   rider price without the surcharge (after all discounts)
 *   riderFareCents  rider price with the surcharge (what was charged)
 *   payBaseCents    pre-discount fare without the surcharge (driver pay basis)
 *   payPeakCents    pre-discount fare with the surcharge
 *   baseShareBps    driver ladder share locked at accept (80/75/70)
 *   poolBalanceCents current pool balance (the draw is capped by it)
 */
export function planPeakTrip({
  baseFareCents,
  riderFareCents,
  payBaseCents = null,
  payPeakCents = null,
  baseShareBps = PEAK_DEFAULTS.baseShareBps,
  poolBalanceCents = 0,
  config: rawConfig = null,
} = {}) {
  const config = normalizePeakConfig(rawConfig)
  const usePay = config.driverPayBasis === 'pre_discount'
  const cut = peakDriverCut({
    baseFareCents,
    riderFareCents,
    payBaseCents: usePay ? payBaseCents : null,
    payPeakCents: usePay ? payPeakCents : null,
    baseShareBps,
    config,
  })
  const bonus = peakBonusCents({ offPeakPayCents: cut.offPeakPayCents, peakCutPayCents: cut.payCents, poolBalanceCents, config })
  let plan = {
    version: PEAK_PRICING_VERSION,
    baseFareCents: cut.baseFareCents,
    riderFareCents: cut.riderFareCents,
    surchargeCents: cut.surchargeCents,
    payBaseCents: cut.payBaseCents,
    payPeakCents: cut.payPeakCents,
    baseShareBps: cut.baseShareBps,
    cutCapped: cut.cutCapped,
    offPeakPayCents: cut.offPeakPayCents,
    peakCutPayCents: cut.payCents,
    cutBps: cut.cutBps,
    surchargeToDriverCents: cut.surchargeToDriverCents,
    bonusCents: bonus.bonusCents,
    bonusTargetCents: bonus.targetCents,
    bonusCappedBy: bonus.cappedBy,
    poolBalanceCents: nonNeg(poolBalanceCents),
    driverTotalCents: cut.payCents + bonus.bonusCents,
  }
  plan = withEconomics(plan)
  let check = checkPeakGuardrails(plan, config)
  if (!check.ok && plan.bonusCents > 0) {
    plan = withEconomics({ ...plan, bonusCents: 0, bonusCappedBy: ['guardrail'], driverTotalCents: plan.peakCutPayCents })
    check = checkPeakGuardrails(plan, config)
  }
  if (!check.ok) {
    // Fail safe: the driver keeps at least off-peak pay plus nothing the surcharge cannot fund.
    const safePay = Math.max(cut.offPeakPayCents, Math.min(cut.payCents, cut.offPeakPayCents + Math.max(0, cut.surchargeCents)))
    plan = withEconomics({ ...plan, peakCutPayCents: safePay, bonusCents: 0, bonusCappedBy: ['guardrail'], driverTotalCents: safePay })
    check = checkPeakGuardrails(plan, config)
  }
  return { ...plan, guardrails: check }
}

function withEconomics(plan) {
  const platformTakeCents = plan.riderFareCents - (plan.driverTotalCents - plan.bonusCents)
  const offPeakTakeCents = plan.baseFareCents - plan.offPeakPayCents
  return {
    ...plan,
    platformTakeCents,
    offPeakPlatformTakeCents: offPeakTakeCents,
    platformDeltaCents: platformTakeCents - offPeakTakeCents,
    poolAfterCents: plan.poolBalanceCents - plan.bonusCents,
    upliftBps: plan.offPeakPayCents > 0 ? Math.round(((plan.driverTotalCents - plan.offPeakPayCents) * BPS) / plan.offPeakPayCents) : 0,
  }
}

/** Base fare (no surcharge) recovered from a charged fare and the charged rate. */
export function baseFareFromCharged(chargedCents, surchargeBps) {
  const charged = nonNeg(chargedCents)
  const bps = nonNeg(surchargeBps)
  if (!bps) return charged
  return Math.round((charged * BPS) / (BPS + bps))
}

export function formatPct(bps) {
  const pct = nonNeg(bps) / 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`
}

function usd(cents) {
  return `$${(nonNeg(cents) / 100).toFixed(2)}`
}

/**
 * Rider copy shown before confirming. Names the reason, the percent, and the
 * dollar amount when known. Never mentions driver earnings.
 */
export function peakRiderLine({ reasonLabel, surchargeBps, surchargeCents = null } = {}) {
  if (!nonNeg(surchargeBps)) return null
  const what = reasonLabel ? `${reasonLabel} peak pricing` : 'Peak pricing'
  const amount = surchargeCents != null && nonNeg(surchargeCents) > 0 ? ` (${usd(surchargeCents)})` : ''
  return `${what}: +${formatPct(surchargeBps)}${amount} is included in this price.`
}

/** Driver copy before going online. Describes the rules, never a dollar promise. */
export function peakDriverLine({ active, reasonLabel } = {}) {
  if (!active) return 'Before you go online: standard fares. No peak surcharge right now.'
  return `Before you go online: ${reasonLabel || 'Peak'} pricing is on. Riders pay a peak surcharge and your cut of the fare is higher. A small pool bonus may be added when the pool has funds.`
}
