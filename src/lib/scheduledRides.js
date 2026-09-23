import { supabase } from './supabase'
import { applyStudentDiscount, priceAirportRide } from './pricing'
import {
  airportCodeForPlace,
  distanceFareCents,
  DRIVER_QUEUE_SELECT,
  firstName,
  formatPickupAt,
  nextReminder,
  tripMeters,
} from './scheduledRideModel'

const sessionStamps = new Set()

export async function estimateScheduledFare({ pickup, dropoff, isStudent = false, at = new Date() }) {
  if (pickup?.lat == null || dropoff?.lat == null) return null
  const code = airportCodeForPlace(dropoff)
  if (code === 'GSP' || code === 'CLT') {
    const priced = await priceAirportRide({
      airport: code,
      isStudent: Boolean(isStudent),
      tier: 'standard',
      at,
    })
    return {
      fareCents: priced.fareCents,
      depositCents: priced.depositCents,
      discountCents: priced.discountCents,
      studentLabel: priced.studentLabel,
      estimate: false,
      source: 'airport_flat',
      airport: code,
    }
  }

  const meters = tripMeters(pickup, dropoff)
  const raw = distanceFareCents(meters, code)
  const student = applyStudentDiscount(raw, { isStudent: Boolean(isStudent), tier: 'standard' })
  return {
    fareCents: student.fareCents,
    depositCents: 0,
    discountCents: student.discountCents,
    studentLabel: student.label,
    estimate: true,
    source: code === 'ATL' ? 'atl_estimate' : 'distance',
    airport: code,
    miles: meters == null ? null : Math.round((meters / 1609.344) * 10) / 10,
  }
}

export async function createScheduledTrip({
  user,
  pickup,
  dropoff,
  pickupAt,
  purpose = 'planned',
  fareCents,
  depositCents = 0,
  fareIsEstimate = true,
  isStudent = false,
  studentDiscountCents = 0,
  studentLabel = null,
}) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!user?.id) throw new Error('Sign in required to schedule a ride')
  if (!pickupAt) throw new Error('Choose a pickup time')

  const when = pickupAt instanceof Date ? pickupAt.toISOString() : new Date(pickupAt).toISOString()
  const riderFirst = firstName(
    user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0],
    'Rider',
  )

  const { data, error } = await supabase
    .from('trips')
    .insert({
      rider_id: user.id,
      status: 'scheduled',
      tier: 'standard',
      pickup_label: pickup.label,
      dropoff_label: dropoff.label,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      fare_cents: Math.round(Number(fareCents) || 0),
      deposit_cents: Math.round(Number(depositCents) || 0),
      passengers: 1,
      pickup_at: when,
      scheduled_for: when,
      rider_note: purpose,
      metadata: {
        kind: 'scheduled',
        purpose,
        rider_first_name: riderFirst,
        fare_is_estimate: Boolean(fareIsEstimate),
        reminders: {},
        isStudent: Boolean(isStudent),
        student_discount_cents: Math.max(0, Math.round(Number(studentDiscountCents) || 0)),
        studentLabel: studentLabel || null,
      },
    })
    .select('id, status, pickup_at, pickup_label, dropoff_label')
    .single()

  if (error) throw new Error(error.message || 'Could not schedule ride')

  const { error: eventError } = await supabase.from('trip_events').insert({
    trip_id: data.id,
    kind: 'scheduled',
    payload: {
      pickup_at: when,
      purpose,
      pickup_label: pickup.label,
      dropoff_label: dropoff.label,
    },
  })
  if (eventError) console.warn('[scheduled]', eventError.message)

  return data
}

export async function listMyScheduledTrips(riderId) {
  if (!supabase || !riderId) return []
  const { data, error } = await supabase
    .from('trips')
    .select('id, status, pickup_label, dropoff_label, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, fare_cents, pickup_at, scheduled_for, rider_note, metadata, driver_id')
    .eq('rider_id', riderId)
    .not('pickup_at', 'is', null)
    .order('pickup_at', { ascending: true })
    .limit(30)
  if (error) throw new Error(error.message)
  return data || []
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
  const { error } = await supabase
    .from('trips')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .eq('id', tripId)
    .in('status', ['scheduled', 'accepted'])
  if (error) throw new Error(error.message || 'Could not cancel scheduled ride')
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
