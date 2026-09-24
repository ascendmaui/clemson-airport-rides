/**
 * Clemson RIDES fare card — version 2026-09-23.
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
 * Surge rules (America/New_York), highest match wins — multipliers do not stack:
 *   airport rush 1.35×  — airport trips, 05:00–08:00 and 15:00–19:00
 *   weekend      1.20×  — Friday 17:00 through Sunday 23:59
 *   game day     1.80×  — active game_day_events row, else fall Saturday
 *                         11:00–23:00 when fallbackWindow.enabled (default on
 *                         because the events table may be empty). An event
 *                         surge_multiplier above 1 is included in the max.
 * Cap SURGE_MAX (2.5).
 */

export const FARE_RATES_VERSION = '2026-09-23'

export const METERS_PER_MILE = 1609.344

export const FARE_CARD = {
  version: FARE_RATES_VERSION,
  currency: 'usd',
  baseCents: 119,
  bookingFeeCents: 265,
  perMileCents: 114,
  perMinuteCents: 18,
  minFareCents: 590,
}

/** 20% of the rider's final price. Driver keeps the rest. */
export const PLATFORM_FEE_BPS = 2000

/** Existing Clemson student Standard discount. */
export const STUDENT_DISCOUNT_BPS = 1000

/**
 * Shared-ride discount. Applies when kind is carpool or the party has 2+ riders.
 * 15% is the solo-vs-shared gap we take (between historical Uber Pool cuts and
 * a token $1 off). Edit here only.
 */
export const CARPOOL_DISCOUNT_BPS = 1500

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

/** 25% of the card remainder, never below Stripe's minimum when cash remains. */
export function cardDepositCents(cashCents) {
  const cash = Math.max(0, Math.round(Number(cashCents) || 0))
  if (cash <= 0) return 0
  const quarter = Math.round(cash * 0.25)
  if (quarter >= MIN_CARD_CHARGE_CENTS) return Math.min(cash, quarter)
  if (cash >= MIN_CARD_CHARGE_CENTS) return Math.min(cash, MIN_CARD_CHARGE_CENTS)
  return 0
}

/**
 * Fare, 25% deposit, and the balance still due.
 * A stored deposit (including 0) wins. Otherwise the deposit is 25% of the fare
 * already in hand — call this after the Standard student discount, not before.
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
  return `Fare ${usd(split?.fareCents)} · 25% deposit ${usd(split?.depositCents)} · remaining balance ${usd(split?.remainingCents)}`
}

export const WAIT_CANCEL = {
  autoCancelAfterMinutes: 7,
  feeCents: 500,
}

export const SURGE_MAX = 2.5
export const SURGE_MIN = 1
export const SURGE_TIME_ZONE = 'America/New_York'

export const SURGE_RULES = [
  {
    id: 'airport_rush',
    label: 'Airport rush',
    multiplier: 1.35,
    requiresAirport: true,
    windows: [
      { startMin: 5 * 60, endMin: 8 * 60 },
      { startMin: 15 * 60, endMin: 19 * 60 },
    ],
  },
  {
    id: 'weekend',
    label: 'Weekend',
    multiplier: 1.2,
    weekendFrom: { weekday: 5, startMin: 17 * 60 },
  },
  {
    id: 'game_day',
    label: 'Game day',
    multiplier: 1.8,
    fallbackWindow: {
      enabled: true,
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
  return Math.min(SURGE_MAX, Math.max(SURGE_MIN, m))
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
 * Highest matching surge rule. Pass gameDayMultiplier from game_day_events
 * when a row overlaps `at` (use null when none).
 */
export function resolveSurge({
  at = new Date(),
  airport = false,
  gameDayMultiplier = null,
  timeZone = SURGE_TIME_ZONE,
} = {}) {
  const when = at instanceof Date ? at : new Date(at)
  const parts = zonedParts(when, timeZone)
  const matched = []

  for (const rule of SURGE_RULES) {
    if (rule.id === 'airport_rush') {
      if (airport && rule.windows.some((w) => inWindow(parts.minutes, w))) {
        matched.push({ id: rule.id, label: rule.label, multiplier: clampSurge(rule.multiplier) })
      }
    } else if (rule.id === 'weekend') {
      if (isWeekend(parts, rule)) {
        matched.push({ id: rule.id, label: rule.label, multiplier: clampSurge(rule.multiplier) })
      }
    } else if (rule.id === 'game_day') {
      const eventMul = Number(gameDayMultiplier)
      const eventOn = Number.isFinite(eventMul) && eventMul > 1
      const windowOn = fallbackGameDay(parts, rule.fallbackWindow)
      if (eventOn || windowOn) {
        const chosen = Math.max(eventOn ? eventMul : 1, windowOn ? rule.multiplier : 1)
        matched.push({ id: rule.id, label: rule.label, multiplier: clampSurge(chosen) })
      }
    }
  }

  if (!matched.length) {
    return { multiplier: 1, rule: null, matched: [], at: when.toISOString() }
  }
  matched.sort((a, b) => b.multiplier - a.multiplier)
  return {
    multiplier: matched[0].multiplier,
    rule: matched[0],
    matched,
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
  useCredits = false,
  creditLots = [],
} = {}) {
  const milesN = miles != null
    ? Math.max(0, Number(miles) || 0)
    : Math.max(0, Number(distanceM) || 0) / METERS_PER_MILE
  const minutesN = minutes != null
    ? Math.max(0, Number(minutes) || 0)
    : Math.max(0, Number(durationS) || 0) / 60

  const distanceCents = Math.round(milesN * FARE_CARD.perMileCents)
  const timeCents = Math.round(minutesN * FARE_CARD.perMinuteCents)
  const meteredCents = FARE_CARD.baseCents + FARE_CARD.bookingFeeCents + distanceCents + timeCents
  const minFareApplied = meteredCents < FARE_CARD.minFareCents
  const rawCents = Math.max(FARE_CARD.minFareCents, meteredCents)
  const vehicleMul = Math.max(0, Number(vehicleMultiplier) || 1)
  const classedCents = Math.round(rawCents * vehicleMul)
  const surgeMul = clampSurge(surgeMultiplier)
  const surgedCents = Math.round(classedCents * surgeMul)

  const carpool = isCarpool
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
      base_cents: FARE_CARD.baseCents,
      booking_fee_cents: FARE_CARD.bookingFeeCents,
      distance_cents: distanceCents,
      time_cents: timeCents,
      metered_cents: meteredCents,
      min_fare_cents: FARE_CARD.minFareCents,
      min_fare_applied: minFareApplied,
      subtotal_cents: classedCents,
      vehicle_multiplier: vehicleMul,
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
