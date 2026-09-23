import { supabase } from './supabase'
import { AIRPORT_RATES, depositCents } from './stripeCheckout'

const STUDENT_PERCENT_OFF = 10

/**
 * Student pricing helper — 10% off Standard when student verified.
 */
export function applyStudentDiscount(fareCents, { isStudent = false, tier = 'standard' } = {}) {
  const base = Number(fareCents) || 0
  if (!isStudent || tier !== 'standard') {
    return { fareCents: base, discountCents: 0, label: null }
  }
  const discountCents = Math.round(base * (STUDENT_PERCENT_OFF / 100))
  return {
    fareCents: base - discountCents,
    discountCents,
    label: `Clemson student · ${STUDENT_PERCENT_OFF}% off Standard`,
  }
}

/**
 * Rider surge from public.game_day_events.surge_multiplier (active overlapping now).
 * Driver incentives use driver_incentives and never read this multiplier.
 * A 1.5 rider surge and a 1.5 driver incentive can both be on and do not stack into each other.
 */
export async function getGameDayMultiplier(at = new Date()) {
  if (!supabase) return { multiplier: 1, event: null }
  const iso = at.toISOString()
  const { data, error } = await supabase
    .from('game_day_events')
    .select(
      'id, title, starts_at, ends_at, surge_multiplier, pickup_zone_label, active',
    )
    .eq('active', true)
    .lte('starts_at', iso)
    .gte('ends_at', iso)
    .order('surge_multiplier', { ascending: false })
    .limit(1)

  if (error || !data?.length) {
    return { multiplier: 1, event: null }
  }
  const event = data[0]
  const multiplier = Number(event.surge_multiplier) || 1
  return { multiplier, event }
}

export async function priceAirportRide({
  airport,
  isStudent = false,
  tier = 'standard',
  at = new Date(),
}) {
  const rate = AIRPORT_RATES[airport]
  if (!rate) throw new Error('Unknown airport')

  const { multiplier, event } = await getGameDayMultiplier(at)
  // Airport flat rates stay flat; game-day note is informational for local tiers.
  // Still surface surge for local/stadium pricing callers.
  const surged = Math.round(rate.fareCents * (tier === 'standard' || airport ? 1 : multiplier))
  const student = applyStudentDiscount(surged, { isStudent, tier })
  const deposit = depositCents(student.fareCents)

  return {
    airport: rate.code,
    fareCents: student.fareCents,
    depositCents: deposit,
    discountCents: student.discountCents,
    studentLabel: student.label,
    gameDay: event
      ? { title: event.title, multiplier, zone: event.pickup_zone_label }
      : null,
  }
}

export function formatUsdFromCents(cents) {
  return (Number(cents) / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}
