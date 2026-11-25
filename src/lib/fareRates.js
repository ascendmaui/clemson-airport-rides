/**
 * Clemson Rides fare card — version 2026-09-23.
 *
 * Research (Greenville–Spartanburg / Clemson, SC mid-size market)
 * UpHail published UberX and Lyft Standard cards for Greenville, SC and
 * Spartanburg, SC (same UberX components in both cities):
 *   https://uphail.com/us/sc/greenville/
 *   https://uphail.com/us/sc/spartanburg/
 *   UberX: base $1.19, per mile $1.14, per minute $0.18,
 *          safe-ride / booking fee $2.65, minimum $5.90,
 *          cancellation about $5.00–$5.75.
 *   Lyft Standard: base $1.20, $1.14/mi, $0.17/min, minimum $3.07,
 *          cancellation $5.00.
 * This card adopts UberX (booking fee + higher minimum). A generic 2026
 * estimator (taxis-fare.com: $2.55 + $1.75/mi + $0.35/min, min $8) matches an
 * older in-repo MVP heuristic and is not used.
 *
 * Product cancellation (prior rule, not Uber's $5.75): $5.00 when a driver
 * has waited and the ride auto-cancels at 7 minutes. Platform 20% = $1.00,
 * driver 80% = $4.00. Wait-time fees use the same 20/80 split.
 *
 * Formula
 *   metered = base + booking + round(miles * per_mile) + round(minutes * per_minute)
 *   raw     = max(min_fare, metered)
 *   classed = round(raw * vehicleMultiplier)          // SUV/van class, optional
 *   surged  = round(classed * surgeMultiplier)        // after base, before discounts
 *   then carpool % off (shared rides), then student % off (verified / @clemson.edu, standard tier)
 *   then prepaid-credit % off ONLY the slice funded by each credit lot (FIFO)
 *   platform = round(riderPays * 20%); driver = riderPays - platform
 *   riderPays = credits debited + card cash (after discounts)
 *
 * Stacking (multiplicative, never additive percents — no double dip):
 *   1. metered fare (and vehicle class)
 *   2. surge (single highest matching rule, clamped to [1, 2.5])
 *   3. carpool discount
 *   4. student discount
 *   4b. frequent-rider pass (TIGER_PASS_DISCOUNT_BPS) when the database row is active
 *   4c. schedule-ahead 10%, when the pickup qualifies
 *   5. prepaid discount on the credit-funded slice only (lot's own %)
 * Card remainder is not prepaid-discounted. Platform 20% is of the final
 * rider price (cash + credits), not of the pre-discount fare.
 *
 * Credit packs — discount is the % attached to the lot being spent (FIFO).
 * A fare that spans two lots uses each lot's % on its own slice.
 *   $50 → 5%, $100 → 10% (required anchor), $200 → 15%.
 * Buying credits is a liability (platform fee 0 at purchase). The 20/80 split
 * is recognized when a ride redeems credits, so driver earnings stay 80% of
 * the discounted fare and the purchase is not taxed twice.
 *
 * Surge rules (America/New_York), highest match wins — multipliers do not stack.
 * John's 2026-10-17 decision (see docs/PEAK_PRICING.md):
 *   weekend      1.00×  — off (a 1.2× weekend made Standard pricier than UberX)
 *   airport rush 1.00×  — off (Clemson Rides must stay under UberX/Lyft)
 *   game day     1.25×  — Clemson home football days only, kickoff-4h to
 *                         kickoff+3h (TBA: stored window), and only when the
 *                         pickup OR dropoff is within ~2 mi of Memorial Stadium
 *                         (shared/gameDaySurge.js). A live game_day_events row
 *                         also opens the window; the radius still applies and
 *                         its surge_multiplier can never exceed the cap.
 * Cap SURGE_MAX (1.25). Scheduled rides use the scheduled pickup time.
 *
 * Rate inputs (base, booking, per-mile, per-minute, minimum) are DB-backed:
 * public.pricing_rate_cards, loaded by server/pricingConfig.js on a short
 * cache and installed with setFareCards(). FARE_CARD is the seed/fallback.
 */

import {
  GAME_DAY_LABEL,
  SURGE_CAP,
  gameDayConfig,
  gameDaySurge,
} from '../../shared/gameDaySurge.js'

export const FARE_RATES_VERSION = '2026-09-23'

export const METERS_PER_MILE = 1609.344

export const FARE_CARD = Object.freeze({
  version: FARE_RATES_VERSION,
  currency: 'usd',
  baseCents: 119,
  bookingFeeCents: 265,
  perMileCents: 114,
  perMinuteCents: 18,
  minFareCents: 590,
})

/** Sanity bounds for a DB-loaded card. A row outside them is ignored (seed stays). */
const CARD_BOUNDS = {
  baseCents: [0, 1000],
  bookingFeeCents: [0, 1000],
  perMileCents: [25, 500],
  perMinuteCents: [0, 200],
  minFareCents: [200, 5000],
}

export function validFareCard(raw) {
  if (!raw || typeof raw !== 'object') return null
  const pick = (a, b) => Number(raw[a] ?? raw[b])
  const card = {
    baseCents: pick('baseCents', 'base_cents'),
    bookingFeeCents: pick('bookingFeeCents', 'booking_fee_cents'),
    perMileCents: pick('perMileCents', 'per_mile_cents'),
    perMinuteCents: pick('perMinuteCents', 'per_minute_cents'),
    minFareCents: pick('minFareCents', 'min_fare_cents'),
  }
  for (const [key, [lo, hi]] of Object.entries(CARD_BOUNDS)) {
    const v = card[key]
    if (!Number.isInteger(v) || v < lo || v > hi) return null
  }
  return card
}

let activeCards = { standard: { ...FARE_CARD } }

/** Active card for a tier. Only Comfort/Wait may carry their own; Carpool is always 50% of Standard. */
export function fareCardFor(tier = 'standard') {
  const id = String(tier ?? 'standard').trim().toLowerCase()
  if (id !== 'standard' && id !== 'carpool' && activeCards[id]) return { card: activeCards[id], own: true }
  return { card: activeCards.standard, own: false }
}

export function activeFareCards() {
  return activeCards
}

/**
 * Install DB rate cards ({ standard: {...}, comfort?: {...}, wait?: {...} }).
 * Invalid rows are skipped; without a valid standard row the seed card stays.
 */
export function setFareCards(cards) {
  const next = { standard: { ...FARE_CARD } }
  for (const [tier, raw] of Object.entries(cards || {})) {
    const card = validFareCard(raw)
    if (!card) continue
    const id = String(tier).trim().toLowerCase()
    if (id === 'carpool') continue
    next[id] = { ...FARE_CARD, ...card }
  }
  activeCards = next
  return activeCards
}

export function resetFareCards() {
  activeCards = { standard: { ...FARE_CARD } }
}

/** 20% of the rider's final price. Driver keeps the rest. */
export const PLATFORM_FEE_BPS = 2000

/** Existing Clemson student Standard discount. */
export const STUDENT_DISCOUNT_BPS = 1000

/**
 * Friend-ride group discount. Applies only when quoteFare is called with
 * isCarpool and the tier is not the Carpool ride option. Two or more friends
 * sharing one fare take 15% off that group total, then split it.
 * The Carpool ride option is not this discount. It is half of Standard per seat
 * (CARPOOL_SEAT_FRACTION_BPS).
 */
export const CARPOOL_DISCOUNT_BPS = 1500

/**
 * Wait & Save is this fraction of the Standard fare (basis points).
 * 8200 is 18% under Standard, inside the 15–20% band. Override with
 * WAIT_SAVE_MULTIPLIER as a fraction (0.80–0.85) or as basis points.
 * quoteFare uses an explicit waitDiscountBps when a discount already exists.
 */
export const WAIT_SAVE_MULTIPLIER_BPS = 8200

/** Extra Comfort is this multiple of Standard. 14000 is 1.40×, inside 1.3–1.5×. */
export const COMFORT_FARE_MULTIPLIER_BPS = 14000

/** Carpool per-seat fare is half of Standard when 3–4 riders split. */
export const CARPOOL_SEAT_FRACTION_BPS = 5000

function boundedBps(envName, fallback, min, max) {
  const raw = process.env[envName]
  if (raw == null || String(raw).trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  const bps = n <= 5 ? Math.round(n * 10000) : Math.round(n)
  if (bps < min || bps > max) return fallback
  return bps
}

/**
 * Scale applied to the metered Standard fare for a ride tier.
 * Standard stays 10000. Wait uses an existing discount when one is passed,
 * otherwise the configurable multiplier. Comfort and Carpool use their constants.
 */
export function tierScaleBps(tier, { waitDiscountBps = null } = {}) {
  const id = String(tier ?? 'standard').trim().toLowerCase()
  if (id === 'wait') {
    const existing = waitDiscountBps == null || waitDiscountBps === ''
      ? null
      : Math.round(Number(waitDiscountBps))
    if (existing != null && Number.isFinite(existing) && existing > 0 && existing < 10000) {
      return 10000 - existing
    }
    return boundedBps('WAIT_SAVE_MULTIPLIER', WAIT_SAVE_MULTIPLIER_BPS, 8000, 8500)
  }
  if (id === 'comfort') {
    return boundedBps('COMFORT_FARE_MULTIPLIER', COMFORT_FARE_MULTIPLIER_BPS, 13000, 15000)
  }
  if (id === 'carpool') return CARPOOL_SEAT_FRACTION_BPS
  return 10000
}

export function scaleCents(cents, bps) {
  return Math.round((Math.round(Number(cents) || 0) * Math.round(Number(bps) || 0)) / 10000)
}

/**
 * Prepaid packs. discountBps is what rides cost when THIS lot is spent.
 * $100 → 10% is the required anchor. Top tier stays inside the 10–15% band.
 */
export const CREDIT_PACKS = [
  { id: 'pack_50', loadCents: 5000, discountBps: 500, label: '$50 · 5% off rides' },
  { id: 'pack_100', loadCents: 10000, discountBps: 1000, label: '$100 · 10% off rides' },
  { id: 'pack_200', loadCents: 20000, discountBps: 1500, label: '$200 · 15% off rides' },
]

/** Stripe USD minimum charge. Smaller card remainders are waived (platform comps). */
export const MIN_CARD_CHARGE_CENTS = 50

export const STRIPE_NOT_CONFIGURED_COPY =
  'Stripe checkout is not configured on this machine. No charge was made. Live mode stays off.'

/**
 * Upfront airport deposit is retired. New quotes collect the full fare at
 * trip end. A stored historical deposit still passes through depositSplit.
 */
export function cardDepositCents(cashCents) {
  void cashCents
  return 0
}

/**
 * Fare and any amount already collected on an older trip.
 * A stored deposit (including 0) wins. New fares have no upfront deposit.
 */
export function depositSplit(fareCents, storedDeposit) {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  const hasStored = storedDeposit != null && storedDeposit !== ''
  const deposit = hasStored
    ? Math.max(0, Math.min(fare, Math.round(Number(storedDeposit) || 0)))
    : cardDepositCents(fare)
  return {
    fareCents: fare,
    depositCents: deposit,
    remainingCents: Math.max(0, fare - deposit),
  }
}

export function depositSplitLabel(split) {
  const usd = (cents) => `$${(Math.max(0, Math.round(Number(cents) || 0)) / 100).toFixed(2)}`
  const deposit = Math.max(0, Math.round(Number(split?.depositCents) || 0))
  if (deposit <= 0) {
    return `Fare ${usd(split?.fareCents)}. The full fare is charged when the trip ends.`
  }
  return `Fare ${usd(split?.fareCents)} · already paid ${usd(deposit)} · remaining ${usd(split?.remainingCents)}`
}

export const WAIT_CANCEL = {
  autoCancelAfterMinutes: 7,
  feeCents: 500,
}

export const SURGE_MAX = SURGE_CAP
export const SURGE_MIN = 1
export const SURGE_TIME_ZONE = 'America/New_York'

export const SURGE_RULES = [
  {
    id: 'airport_rush',
    label: 'Airport rush',
    multiplier: 1,
    requiresAirport: true,
    windows: [
      { startMin: 5 * 60, endMin: 8 * 60 },
      { startMin: 15 * 60, endMin: 19 * 60 },
    ],
  },
  {
    id: 'weekend',
    label: 'Weekend',
    multiplier: 1,
    weekendFrom: { weekday: 5, startMin: 17 * 60 },
  },
  {
    id: 'game_day',
    label: GAME_DAY_LABEL,
    multiplier: 1.25,
    radiusMiles: 2,
    // Every-fall-Saturday fallback is retired: game days come from clemson_home_games.
    fallbackWindow: {
      enabled: false,
      months: [8, 9, 10, 11],
      weekday: 6,
      startMin: 11 * 60,
      endMin: 23 * 60,
    },
  },
]

/** Typical drive when Google Routes is unavailable. Not a flat published fare. */
export const AIRPORT_ROUTE_FALLBACK = {
  GSP: { miles: 48, minutes: 55, label: 'Clemson campus → GSP' },
  CLT: { miles: 130, minutes: 130, label: 'Clemson campus → CLT' },
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function zonedParts(date, timeZone = SURGE_TIME_ZONE) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  return {
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    month: Number(parts.month),
  }
}

export function clampSurge(multiplier) {
  const m = Number(multiplier)
  if (!Number.isFinite(m) || m <= 0) return 1
  return Math.min(gameDayConfig().surgeCap, SURGE_MAX, Math.max(SURGE_MIN, m))
}

function inWindow(minutes, window) {
  return minutes >= window.startMin && minutes < window.endMin
}

function isWeekend(parts, rule) {
  const from = rule.weekendFrom || { weekday: 5, startMin: 17 * 60 }
  if (parts.weekday === 6 || parts.weekday === 0) return true
  if (parts.weekday === from.weekday && parts.minutes >= from.startMin) return true
  return false
}

function fallbackGameDay(parts, window) {
  if (!window?.enabled) return false
  if (parts.weekday !== window.weekday) return false
  if (!window.months.includes(parts.month)) return false
  return inWindow(parts.minutes, window)
}

/**
 * Highest matching surge rule (never stacked, capped at SURGE_MAX = 1.25).
 * gameDayMultiplier: what loadGameDayMultiplier returned for `at` (a live
 * game_day_events row; null when none). pickup/dropoff ({ lat, lng }) decide
 * the Memorial Stadium radius; without them game-day pricing cannot apply.
 */
export function resolveSurge({
  at = new Date(),
  airport = false,
  gameDayMultiplier = null,
  pickup = null,
  dropoff = null,
  timeZone = SURGE_TIME_ZONE,
} = {}) {
  const when = at instanceof Date ? at : new Date(at)
  const parts = zonedParts(when, timeZone)
  const cfg = gameDayConfig()
  const matched = []

  for (const rule of SURGE_RULES) {
    if (rule.id === 'airport_rush') {
      if (airport && rule.multiplier > 1 && rule.windows.some((w) => inWindow(parts.minutes, w))) {
        matched.push({ id: rule.id, label: rule.label, multiplier: clampSurge(rule.multiplier) })
      }
    } else if (rule.id === 'weekend') {
      const weekendMul = Math.max(rule.multiplier, cfg.weekendMultiplier)
      if (weekendMul > 1 && isWeekend(parts, rule)) {
        matched.push({ id: rule.id, label: rule.label, multiplier: clampSurge(weekendMul) })
      }
    } else if (rule.id === 'game_day') {
      const eventMul = Number(gameDayMultiplier)
      const eventOn = gameDayMultiplier != null && Number.isFinite(eventMul)
      const windowOn = fallbackGameDay(parts, rule.fallbackWindow)
      const game = gameDaySurge({ at: when, pickup, dropoff, eventActive: eventOn || windowOn })
      if (game.applies) {
        matched.push({
          id: rule.id,
          label: rule.label,
          multiplier: clampSurge(game.multiplier),
          reason: game.reason,
          game: game.game ? { date: game.game.date, opponent: game.game.opponent, tba: game.game.tba } : null,
        })
      }
    }
  }

  const live = matched.filter((m) => m.multiplier > 1)
  if (!live.length) {
    return { multiplier: 1, rule: null, matched: [], at: when.toISOString() }
  }
  live.sort((a, b) => b.multiplier - a.multiplier)
  return {
    multiplier: live[0].multiplier,
    rule: live[0],
    matched: live,
    at: when.toISOString(),
  }
}

export function percentOffCents(amountCents, bps) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0))
  const rate = Math.max(0, Math.min(10000, Math.round(Number(bps) || 0)))
  const discountCents = Math.round((amount * rate) / 10000)
  return { amountCents: amount - discountCents, discountCents, bps: rate }
}

/** 20% platform / 80% driver. $5.00 → platform $1.00, driver $4.00. */
export function splitPlatformFee(amountCents) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0))
  const platformFeeCents = Math.round((amount * PLATFORM_FEE_BPS) / 10000)
  const driverEarningsCents = amount - platformFeeCents
  return {
    amountCents: amount,
    platformFeeCents,
    driverEarningsCents,
    platformFeeBps: PLATFORM_FEE_BPS,
  }
}

export function quoteWaitCancelFee() {
  const split = splitPlatformFee(WAIT_CANCEL.feeCents)
  return {
    kind: 'cancellation_fee',
    afterMinutes: WAIT_CANCEL.autoCancelAfterMinutes,
    ...split,
  }
}

export function findCreditPack(packId) {
  return CREDIT_PACKS.find((p) => p.id === packId) || null
}

/**
 * FIFO lots. Each lot's discountBps applies only to the pre-discount fare
 * slice that lot funds. Returns the card remainder with no prepaid discount.
 */
export function applyCreditLots(fareCents, lots) {
  let remainingFare = Math.max(0, Math.round(Number(fareCents) || 0))
  const debits = []
  let creditsDebitedCents = 0
  let creditDiscountCents = 0

  for (const lot of lots || []) {
    if (remainingFare <= 0) break
    const face = Math.max(0, Math.round(Number(lot.remainingCents ?? lot.remaining_cents) || 0))
    if (face <= 0) continue
    const bps = Math.max(0, Math.min(10000, Math.round(Number(lot.discountBps ?? lot.discount_bps) || 0)))
    const payBps = 10000 - bps
    if (payBps <= 0) continue

    let slice = Math.min(remainingFare, Math.floor((face * 10000) / payBps))
    let pay = Math.round((slice * payBps) / 10000)
    while (pay > face && slice > 0) {
      slice -= 1
      pay = Math.round((slice * payBps) / 10000)
    }
    if (slice <= 0 || pay <= 0) continue

    const discount = slice - pay
    debits.push({
      lotId: lot.id || null,
      sliceCents: slice,
      debitCents: pay,
      discountCents: discount,
      discountBps: bps,
    })
    creditsDebitedCents += pay
    creditDiscountCents += discount
    remainingFare -= slice
  }

  const cashCents = remainingFare
  return {
    fareBeforeCreditsCents: Math.max(0, Math.round(Number(fareCents) || 0)),
    creditsDebitedCents,
    creditDiscountCents,
    cashCents,
    riderPaysCents: creditsDebitedCents + cashCents,
    debits,
  }
}

/** Drop a card remainder Stripe cannot charge. Platform comps those cents. */
export function finalizeSettlement(applied) {
  let cashCents = Math.max(0, Math.round(applied.cashCents || 0))
  let waivedCents = 0
  if (cashCents > 0 && cashCents < MIN_CARD_CHARGE_CENTS) {
    waivedCents = cashCents
    cashCents = 0
  }
  const riderPaysCents = Math.max(0, Math.round(applied.creditsDebitedCents || 0)) + cashCents
  const split = splitPlatformFee(riderPaysCents)
  return {
    ...applied,
    cashCents,
    waivedCents,
    riderPaysCents,
    ...split,
  }
}

export function quoteFare({
  distanceM,
  durationS,
  miles,
  minutes,
  vehicleMultiplier = 1,
  surgeMultiplier = 1,
  isCarpool = false,
  isStudent = false,
  tier = 'standard',
  waitDiscountBps = null,
  useCredits = false,
  creditLots = [],
} = {}) {
  const milesN = miles != null
    ? Math.max(0, Number(miles) || 0)
    : Math.max(0, Number(distanceM) || 0) / METERS_PER_MILE
  const minutesN = minutes != null
    ? Math.max(0, Number(minutes) || 0)
    : Math.max(0, Number(durationS) || 0) / 60

  const tierId = String(tier ?? 'standard').trim().toLowerCase() || 'standard'
  // A tier with its own DB card is priced on it directly (no Standard scale).
  // Wait & Save with an explicit waitDiscountBps keeps the Standard path.
  const picked = waitDiscountBps != null && waitDiscountBps !== '' ? { card: activeCards.standard, own: false } : fareCardFor(tierId)
  const card = picked.card
  const distanceCents = Math.round(milesN * card.perMileCents)
  const timeCents = Math.round(minutesN * card.perMinuteCents)
  const meteredCents = card.baseCents + card.bookingFeeCents + distanceCents + timeCents
  const minFareApplied = meteredCents < card.minFareCents
  const rawCents = Math.max(card.minFareCents, meteredCents)
  const scaleBps = picked.own ? 10000 : tierScaleBps(tierId, { waitDiscountBps })
  const callerMul = Math.max(0, Number(vehicleMultiplier) || 1)
  const vehicleMul = Math.round(callerMul * scaleBps) / 10000
  const classedCents = Math.round(Math.round(rawCents * callerMul) * scaleBps / 10000)
  const surgeMul = clampSurge(surgeMultiplier)
  // Carpool seat = 50% of the (surged) Standard fare: surge the base first, then halve.
  const surgedCents = tierId === 'carpool' && !picked.own
    ? Math.round(Math.round(Math.round(rawCents * callerMul) * surgeMul) * scaleBps / 10000)
    : Math.round(classedCents * surgeMul)

  // Friend rides with 2+ people keep CARPOOL_DISCOUNT_BPS on the group fare.
  // The Carpool ride option is the seat fraction above, not a second discount.
  const sharedSeat = Boolean(isCarpool) && tierId !== 'carpool'
  const carpool = sharedSeat
    ? percentOffCents(surgedCents, CARPOOL_DISCOUNT_BPS)
    : { amountCents: surgedCents, discountCents: 0, bps: 0 }
  const studentOk = Boolean(isStudent) && (tier == null || tier === 'standard')
  const student = studentOk
    ? percentOffCents(carpool.amountCents, STUDENT_DISCOUNT_BPS)
    : { amountCents: carpool.amountCents, discountCents: 0, bps: 0 }

  const creditPlan = useCredits
    ? applyCreditLots(student.amountCents, creditLots)
    : {
        fareBeforeCreditsCents: student.amountCents,
        creditsDebitedCents: 0,
        creditDiscountCents: 0,
        cashCents: student.amountCents,
        riderPaysCents: student.amountCents,
        debits: [],
      }
  const settled = finalizeSettlement(creditPlan)

  return {
    version: FARE_RATES_VERSION,
    fareCents: settled.riderPaysCents,
    fareBeforeDiscountsCents: surgedCents,
    fareBeforeCreditsCents: student.amountCents,
    miles: milesN,
    minutes: minutesN,
    ...settled,
    breakdown: {
      version: FARE_RATES_VERSION,
      base_cents: card.baseCents,
      booking_fee_cents: card.bookingFeeCents,
      distance_cents: distanceCents,
      time_cents: timeCents,
      metered_cents: meteredCents,
      min_fare_cents: card.minFareCents,
      per_mile_cents: card.perMileCents,
      per_minute_cents: card.perMinuteCents,
      min_fare_applied: minFareApplied,
      subtotal_cents: classedCents,
      vehicle_multiplier: vehicleMul,
      tier_scale_bps: scaleBps,
      surge_multiplier: surgeMul,
      surge_cents: surgedCents - classedCents,
      surged_cents: surgedCents,
      carpool_discount_bps: carpool.bps,
      carpool_discount_cents: carpool.discountCents,
      student_discount_bps: student.bps,
      student_discount_cents: student.discountCents,
      fare_before_credits_cents: student.amountCents,
      credit_discount_cents: settled.creditDiscountCents,
      credits_debited_cents: settled.creditsDebitedCents,
      cash_cents: settled.cashCents,
      waived_cents: settled.waivedCents,
      rider_pays_cents: settled.riderPaysCents,
      platform_fee_cents: settled.platformFeeCents,
      driver_earnings_cents: settled.driverEarningsCents,
      platform_fee_bps: PLATFORM_FEE_BPS,
    },
  }
}

/** Driver home: prefer stored earnings, else 80% of the fare. */
export function driverEarningsFromTrip(trip) {
  if (!trip) return 0
  if (trip.driver_earnings_cents != null && trip.driver_earnings_cents !== '') {
    return Math.max(0, Math.round(Number(trip.driver_earnings_cents) || 0))
  }
  return splitPlatformFee(trip.fare_cents).driverEarningsCents
}

export function feeMetadata(amountCents, extra = {}) {
  const split = splitPlatformFee(amountCents)
  const out = {
    platform_fee_cents: String(split.platformFeeCents),
    driver_earnings_cents: String(split.driverEarningsCents),
    platform_fee_bps: String(PLATFORM_FEE_BPS),
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value == null) continue
    out[key] = String(value)
  }
  return out
}

/**
 * Direct charges are the repo pattern (no Connect account on profiles).
 * When a destination account exists, Stripe application_fee_amount is the
 * platform 20% and the rest transfers to the driver.
 */
export function connectFeeFields(amountCents, destinationAccountId) {
  if (!destinationAccountId) return {}
  const split = splitPlatformFee(amountCents)
  return {
    application_fee_amount: split.platformFeeCents,
    transfer_data: { destination: destinationAccountId },
  }
}
