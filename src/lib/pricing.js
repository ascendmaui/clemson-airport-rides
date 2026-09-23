import { supabase } from './supabase'
import { depositCents } from './stripeCheckout'
import {
  quoteFare,
  resolveSurge,
  percentOffCents,
  STUDENT_DISCOUNT_BPS,
  AIRPORT_ROUTE_FALLBACK,
} from './fareRates'

export { STUDENT_DISCOUNT_BPS }

/**
 * Student pricing — 10% off Standard after surge and carpool.
 * Kept for callers that already have a fare in cents.
 */
export function applyStudentDiscount(fareCents, { isStudent = false, tier = 'standard' } = {}) {
  const base = Number(fareCents) || 0
  if (!isStudent || (tier && tier !== 'standard')) {
    return { fareCents: base, discountCents: 0, label: null }
  }
  const off = percentOffCents(base, STUDENT_DISCOUNT_BPS)
  return {
    fareCents: off.amountCents,
    discountCents: off.discountCents,
    label: `Clemson student · ${STUDENT_DISCOUNT_BPS / 100}% off Standard`,
  }
}

/**
 * Rider surge from public.game_day_events.surge_multiplier (active overlapping now).
 * Driver incentives use driver_incentives and never read this multiplier.
 * A 1.5 rider surge and a 1.5 driver incentive can both be on and do not stack into each other.
 */
export async function getGameDayMultiplier(at = new Date()) {
  if (!supabase) return { multiplier: null, event: null }
  const iso = (at instanceof Date ? at : new Date(at)).toISOString()
  const { data, error } = await supabase
    .from('game_day_events')
    .select('id, title, starts_at, ends_at, surge_multiplier, pickup_zone_label, active')
    .eq('active', true)
    .lte('starts_at', iso)
    .gte('ends_at', iso)
    .order('surge_multiplier', { ascending: false })
    .limit(1)

  if (error || !data?.length) return { multiplier: null, event: null }
  const event = data[0]
  const multiplier = Number(event.surge_multiplier)
  return { multiplier: Number.isFinite(multiplier) ? multiplier : null, event }
}

export async function quoteWithSurge({
  at = new Date(),
  airport = false,
  miles,
  minutes,
  distanceM,
  durationS,
  isStudent = false,
  isCarpool = false,
  tier = 'standard',
  vehicleMultiplier = 1,
} = {}) {
  const { multiplier: gameDayMultiplier, event } = await getGameDayMultiplier(at)
  const surge = resolveSurge({ at, airport, gameDayMultiplier })
  const quote = quoteFare({
    miles,
    minutes,
    distanceM,
    durationS,
    surgeMultiplier: surge.multiplier,
    isStudent,
    isCarpool,
    tier,
    vehicleMultiplier,
  })
  return {
    quote,
    surge,
    gameDay: event
      ? { title: event.title, multiplier: surge.multiplier, zone: event.pickup_zone_label }
      : null,
  }
}

export async function priceAirportRide({
  airport,
  isStudent = false,
  tier = 'standard',
  at = new Date(),
  distanceM,
  durationS,
}) {
  const fallback = AIRPORT_ROUTE_FALLBACK[airport]
  if (!fallback) throw new Error('Unknown airport')
  const priced = await quoteWithSurge({
    at,
    airport: true,
    distanceM,
    durationS,
    miles: distanceM == null ? fallback.miles : undefined,
    minutes: durationS == null ? fallback.minutes : undefined,
    isStudent,
    tier,
  })
  const fareCents = priced.quote.fareBeforeCreditsCents
  return {
    airport,
    fareCents,
    depositCents: depositCents(fareCents),
    discountCents: priced.quote.breakdown.student_discount_cents,
    studentLabel: priced.quote.breakdown.student_discount_cents
      ? `Clemson student · ${STUDENT_DISCOUNT_BPS / 100}% off Standard`
      : null,
    surge: priced.surge,
    gameDay: priced.gameDay,
    quote: priced.quote,
    platformFeeCents: priced.quote.platformFeeCents,
    driverEarningsCents: priced.quote.driverEarningsCents,
  }
}

export function formatUsdFromCents(cents) {
  return (Number(cents) / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}
