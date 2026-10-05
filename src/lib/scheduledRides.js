import { supabase } from './supabase'
import { createServerScheduledTrip } from './payments'
import { fetchRideQuote } from './rideBilling'
import {
  DRIVER_QUEUE_SELECT,
  formatPickupAt,
  nextReminder,
} from './scheduledRideModel'

const sessionStamps = new Set()

export async function estimateScheduledFare({ pickup, dropoff, isStudent = false, at = new Date(), tier = 'standard' } = {}) {
  void isStudent
  if (pickup?.lat == null || dropoff?.lat == null) return null
  const when = at instanceof Date ? at.toISOString() : new Date(at).toISOString()
  const data = await fetchRideQuote({
    pickup,
    dropoff,
    at: when,
    tier,
  })
  return {
    fareCents: data.fareCents,
    depositCents: data.depositCents,
    discountCents: data.discountCents || 0,
    fareBeforeScheduleDiscountCents: data.fareBeforeScheduleDiscountCents ?? data.fareCents,
    scheduleDiscountPct: data.scheduleDiscountPct || 0,
    scheduleDiscountCents: data.scheduleDiscountCents || 0,
    scheduleDiscountApplied: Boolean(data.scheduleDiscountApplied),
    studentLabel: data.discountCents > 0 ? 'Clemson student · 10% off Standard' : null,
    estimate: Boolean(data.estimate),
    source: 'server',
    airport: data.airport || null,
    miles: data.quote?.miles == null ? null : Math.round(Number(data.quote.miles) * 10) / 10,
    surge: data.surge || null,
    gameDay: data.gameDay || null,
  }
}

export async function createScheduledTrip({
  user,
  pickup,
  dropoff,
  pickupAt,
  purpose = 'planned',
  tier = 'standard',
  billingChoice = null,
}) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!user?.id) throw new Error('Sign in required to schedule a ride')
  if (!pickupAt) throw new Error('Choose a pickup time')

  const when = pickupAt instanceof Date ? pickupAt.toISOString() : new Date(pickupAt).toISOString()
  const data = await createServerScheduledTrip({
    pickup,
    dropoff,
    pickupAt: when,
    purpose,
    tier,
    weekdays: [],
    ...(billingChoice ? { billingChoice } : {}),
  })
  return {
    ...data.trip,
    fare_cents: data.trip?.fare_cents ?? data.fareCents,
    deposit_cents: data.trip?.deposit_cents ?? data.depositCents,
    discountCents: data.discountCents,
  }
}

export async function listMyScheduledTrips(riderId) {
  if (!supabase || !riderId) return []
  const { data, error } = await supabase
    .from('trips')
    .select('id, status, pickup_label, dropoff_label, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, fare_cents, deposit_cents, pickup_at, scheduled_for, rider_note, metadata, driver_id')
    .eq('rider_id', riderId)
    .in('status', ['scheduled', 'searching', 'offered', 'accepted', 'arriving', 'arrived', 'in_progress'])
    .or('pickup_at.not.is.null,metadata->>scheduled_pickup_at.not.is.null')
    .order('pickup_at', { ascending: true })
    .limit(100)
  if (error) throw new Error(error.message)
  return (data || []).sort((a, b) => new Date(a.pickup_at || a.metadata?.scheduled_pickup_at) - new Date(b.pickup_at || b.metadata?.scheduled_pickup_at))
}

export async function listOpenScheduledTrips() {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('trips')
    .select(DRIVER_QUEUE_SELECT)
    .eq('status', 'scheduled')
    .is('driver_id', null)
    .order('pickup_at', { ascending: true })
    .limit(25)
  if (error) throw new Error(error.message)
  return data || []
}

export async function listDriverScheduledTrips(driverId) {
  if (!supabase || !driverId) return []
  const { data, error } = await supabase
    .from('trips')
    .select(DRIVER_QUEUE_SELECT)
    .eq('driver_id', driverId)
    .in('status', ['accepted', 'arriving'])
    .not('pickup_at', 'is', null)
    .order('pickup_at', { ascending: true })
    .limit(20)
  if (error) throw new Error(error.message)
  return data || []
}

export async function acceptScheduledTrip(tripId) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!tripId) throw new Error('Missing scheduled ride')
  const { data, error } = await supabase.rpc('accept_scheduled_trip', { p_trip_id: tripId })
  if (error) throw new Error(error.message || 'Could not accept scheduled ride')
  return data
}

export async function cancelScheduledTrip(tripId) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('trips')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .eq('id', tripId)
    .in('status', ['scheduled', 'searching', 'offered', 'accepted'])
    .select('id')
  if (error) throw new Error(error.message || 'Could not cancel scheduled ride')
  if (!data?.length) throw new Error('This ride has changed. Refresh your upcoming rides.')
}

/**
 * Returns the next reminder to show, once per browser session per window.
 * Does not write the database — callers that own the trip should stamp it.
 */
export function takeReminder(trip, now = new Date(), { windows } = {}) {
  if (!trip?.id) return null
  const stamps = { ...(trip.metadata?.reminders || {}) }
  for (const id of ['m15', 'h1', 'h24', 'now']) {
    if (sessionStamps.has(`${trip.id}:${id}`)) stamps[id] = true
  }
  const decision = nextReminder(trip, now, stamps)
  if (!decision) return null
  if (windows && !windows.includes(decision.id)) return null
  sessionStamps.add(`${trip.id}:${decision.id}`)
  return decision
}

export function reminderCopy(trip, decision) {
  const when = formatPickupAt(trip.pickup_at || trip.scheduled_for)
  const route = `${trip.pickup_label || trip.pickupLabel || 'Pickup'} → ${trip.dropoff_label || trip.dropoffLabel || 'Drop-off'}`
  return {
    kind: 'ride_reminder',
    title: decision.label,
    body: `${route} · ${when}`,
  }
}

export async function stampScheduledReminder(trip, windowId) {
  if (!supabase || !trip?.id || !windowId) return { ok: false }
  const { data, error } = await supabase.rpc('stamp_scheduled_reminder', {
    p_trip_id: trip.id,
    p_window: windowId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: data != null, metadata: data }
}
