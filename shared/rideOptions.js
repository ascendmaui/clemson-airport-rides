/**
 * Ride options offered to riders: Standard, Wait & Save, Extra Comfort, Carpool.
 * Pricing helpers here never read a client fare. Schedule-ahead 10% is
 * applied only when the caller marks a pickup as scheduled and the pickup
 * is at least the scheduling lead time ahead.
 *
 * Wait & Save, Extra Comfort, and Carpool per-seat prices are scales of the
 * Standard fare inside quoteFare (src/lib/fareRates.js). Carpool groups of
 * 3–4 nearby riders share one trip; each seat is half of Standard.
 */
import { MIN_LEAD_MS } from '../src/lib/scheduledRideModel.js'
import { cardDepositCents, percentOffCents, splitPlatformFee } from '../src/lib/fareRates.js'

export const OFFERED_RIDE_TIERS = ['standard', 'wait', 'comfort', 'carpool']

/** Seats one rider can request. A matched carpool is 3 to 4 riders, each on their own seat. */
export const CARPOOL_MAX_SEATS = 2

/** Approximate pickup wait shown on the ride-type cards. Trip time comes from the quote. */
export const APPROX_ETA_MINUTES = Object.freeze({
  standard: 4,
  wait: 12,
  comfort: 6,
  carpool: 8,
})

export const RIDE_OPTION_CATALOG = [
  { id: 'standard', name: 'Standard', icon: '🚗', eta: '4 min', meta: '4 seats', price: 18.5 },
  { id: 'wait', name: 'Wait & Save', icon: '⏱️', eta: '12 min', meta: 'Save ~20%', price: 14.2 },
  { id: 'comfort', name: 'Extra Comfort', icon: '🚙', eta: '6 min', meta: 'Nicer cars', price: 23 },
  { id: 'carpool', name: 'Carpool', icon: '👥', eta: '8 min', meta: '50% of Standard per seat', price: 15.73 },
]

/** Bottom line on the Standard card: approximate pickup ETA and trip time. */
export function standardCardTiming({ etaMinutes, tripMinutes } = {}) {
  const eta = Math.round(Number(etaMinutes))
  const trip = Math.round(Number(tripMinutes))
  const away = Number.isFinite(eta) && eta > 0 ? `About ${eta} min away` : ''
  const ride = Number.isFinite(trip) && trip > 0 ? `${trip} min trip` : ''
  return [away, ride].filter(Boolean).join(' · ')
}

export const SCHEDULE_AHEAD_DISCOUNT_PCT = 10
export const SCHEDULE_AHEAD_DISCOUNT_BPS = SCHEDULE_AHEAD_DISCOUNT_PCT * 100
export const SCHEDULE_AHEAD_LABEL = 'Schedule ahead and save 10%'
export const NO_DRIVERS_AVAILABLE_COPY = 'No drivers available right now'
export const RIDE_OPTIONS_POLL_MS = 10_000

/** Active trip means the driver cannot take another rider right now. */
export const BUSY_TRIP_STATUSES = ['accepted', 'arriving', 'arrived', 'in_progress']

/**
 * A driver already committed near this pickup is not expected to be free.
 * 45 minutes matches the window when a scheduled ride enters live matching.
 */
export const SCHEDULE_CONFLICT_MS = 45 * 60 * 1000

const BLOCKED_TIER_PARTS = [
  ['te', 'sla'],
  ['te', 'sla_self_driving'],
  ['robo', 'taxi'],
  ['auto', 'nomous'],
  ['self', '-driving'],
  ['self', ' driving'],
]

function blockedTierNeedles() {
  return BLOCKED_TIER_PARTS.map((parts) => parts.join(''))
}

export function isBlockedRideTier(raw) {
  const tier = String(raw ?? '').trim().toLowerCase()
  if (!tier) return false
  return blockedTierNeedles().some((needle) => tier.includes(needle))
}

export function isOfferedRideTier(raw) {
  return OFFERED_RIDE_TIERS.includes(String(raw ?? '').trim().toLowerCase())
}

/**
 * Blank becomes Standard. Offered ids pass through.
 * Anything else, including retired fleet ids, is an error and must not be priced.
 */
export function resolveOfferedTier(raw) {
  const tier = String(raw ?? '').trim().toLowerCase()
  if (!tier) return 'standard'
  if (isOfferedRideTier(tier)) return tier
  const error = new Error('That ride option is not offered.')
  error.status = 400
  error.code = 'ride_option_unavailable'
  throw error
}

export function rideOptionLabel(raw) {
  const tier = String(raw ?? '').trim().toLowerCase()
  if (tier === 'standard') return 'Standard'
  if (tier === 'wait') return 'Wait & Save'
  if (tier === 'comfort') return 'Extra Comfort'
  if (tier === 'carpool') return 'Carpool'
  return 'Retired option'
}

/**
 * Carpool prices one or two seats. Any other tier prices a single passenger
 * here; callers that already store a larger party keep their own count.
 */
export function carpoolSeatCount(tier, raw) {
  if (String(tier ?? '').trim().toLowerCase() !== 'carpool') return 1
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(CARPOOL_MAX_SEATS, n)
}

/** Extra Comfort matches only a vehicle with service_class comfort. Tier and make are not a signal. */
export function vehicleServesComfort(vehicle) {
  return String(vehicle?.service_class || '').trim().toLowerCase() === 'comfort'
}

export function serviceClassFromBody(body) {
  const raw = String(body?.serviceClass || body?.service_class || '').trim().toLowerCase()
  return raw === 'comfort' ? 'comfort' : 'standard'
}

export function driverQualifiesForTier(driver, tier) {
  // Carpool uses the same drivers as Standard. Seat matching groups nearby
  // riders; demo cars are not candidates.
  if (tier === 'standard' || tier === 'wait' || tier === 'carpool') {
    return Boolean(driver?.approved) && !driver?.suspended
  }
  if (tier === 'comfort') return Boolean(driver?.approved) && !driver?.suspended && Boolean(driver?.comfort)
  return false
}

function driverFreeNow(driver) {
  return Boolean(driver?.online) && !driver?.busy
}

/**
 * @param {Array<{ id: string, approved: boolean, suspended?: boolean, online?: boolean, busy?: boolean, comfort?: boolean, conflict?: boolean }>} drivers
 * @param {'now' | 'scheduled'} mode
 */
export function tiersFromDrivers(drivers, mode) {
  const list = Array.isArray(drivers) ? drivers : []
  const ids = []
  for (const tier of OFFERED_RIDE_TIERS) {
    const match = list.some((driver) => {
      if (!driverQualifiesForTier(driver, tier)) return false
      if (mode === 'scheduled') return !driver.conflict
      return driverFreeNow(driver)
    })
    if (match) ids.push(tier)
  }
  return ids
}

export function catalogForTierIds(ids) {
  const allowed = new Set(ids || [])
  return RIDE_OPTION_CATALOG.filter((row) => allowed.has(row.id))
}

export function scheduleAheadApplies(at, now = new Date()) {
  const when = at instanceof Date ? at.getTime() : new Date(at).getTime()
  const clock = now instanceof Date ? now.getTime() : new Date(now).getTime()
  if (!Number.isFinite(when) || !Number.isFinite(clock)) return false
  return when >= clock + MIN_LEAD_MS
}

/**
 * 10% off a server fare that is already the tier price (surge and student
 * included). Tips are not an input. Scheduling does not add an upfront charge.
 */
export function applyScheduleAheadDiscount(priced, { at, now = new Date(), enabled = false } = {}) {
  const before = Math.max(0, Math.round(Number(priced?.fareCents) || 0))
  const base = {
    ...priced,
    fareBeforeScheduleDiscountCents: before,
    scheduleDiscountPct: 0,
    scheduleDiscountCents: 0,
    scheduleDiscountApplied: false,
  }
  if (!enabled || !scheduleAheadApplies(at, now)) return base
  const off = percentOffCents(before, SCHEDULE_AHEAD_DISCOUNT_BPS)
  const fareCents = off.amountCents
  const hadDeposit = Math.round(Number(priced?.depositCents) || 0) > 0
  const depositCents = hadDeposit ? cardDepositCents(fareCents) : 0
  const split = splitPlatformFee(fareCents)
  const previous = priced?.breakdown && typeof priced.breakdown === 'object' ? priced.breakdown : {}
  return {
    ...priced,
    fareCents,
    depositCents,
    fareBeforeScheduleDiscountCents: before,
    scheduleDiscountPct: SCHEDULE_AHEAD_DISCOUNT_PCT,
    scheduleDiscountCents: off.discountCents,
    scheduleDiscountApplied: true,
    breakdown: {
      ...previous,
      fare_before_schedule_discount_cents: before,
      schedule_discount_pct: SCHEDULE_AHEAD_DISCOUNT_PCT,
      schedule_discount_cents: off.discountCents,
      fare_before_credits_cents: fareCents,
      rider_pays_cents: fareCents,
      platform_fee_cents: split.platformFeeCents,
      driver_earnings_cents: split.driverEarningsCents,
    },
  }
}

export function scheduleDiscountMetadata(priced) {
  return {
    schedule_discount_pct: Math.max(0, Math.round(Number(priced?.scheduleDiscountPct) || 0)),
    schedule_discount_cents: Math.max(0, Math.round(Number(priced?.scheduleDiscountCents) || 0)),
    fare_before_schedule_discount_cents: Math.max(
      0,
      Math.round(Number(priced?.fareBeforeScheduleDiscountCents ?? priced?.fareCents) || 0),
    ),
  }
}

export function pickupConflicts(pickupAt, scheduledFor, windowMs = SCHEDULE_CONFLICT_MS) {
  const a = new Date(pickupAt).getTime()
  const b = new Date(scheduledFor).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.abs(a - b) <= windowMs
}
