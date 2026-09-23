/**
 * Driver desk: availability, PickDriver requests, scheduled queue, live status.
 * Payments go through the existing /api/driver and /api/stripe-payment-methods routers.
 */
import { authedJson } from './apiClient.js'
import {
  formatCents,
  isActiveStatus,
  isDueNow,
  nextTripStatus,
  summarizeDepositAwareness,
  toDriverCard,
} from './tripTags.js'

const TRIP_COLUMNS = [
  'id',
  'rider_id',
  'driver_id',
  'status',
  'tier',
  'pickup_label',
  'dropoff_label',
  'pickup_lat',
  'pickup_lng',
  'dropoff_lat',
  'dropoff_lng',
  'fare_cents',
  'deposit_cents',
  'passengers',
  'pickup_at',
  'scheduled_for',
  'rider_note',
  'metadata',
  'accepted_at',
  'arrived_at',
  'completed_at',
].join(', ')

const EARNINGS_COLUMNS = 'id, status, fare_cents, deposit_cents, dropoff_label, completed_at, pickup_label'

async function listTrips(supabase, finish) {
  const run = async (columns) => finish(supabase.from('trips').select(columns))
  let res = await run(TRIP_COLUMNS)
  if (res.error && /deposit_cents|column|schema cache/i.test(res.error.message || '')) {
    res = await run(TRIP_COLUMNS.replace('deposit_cents, ', ''))
  }
  if (res.error) throw new Error(res.error.message)
  return res.data || []
}

async function writeTripEvent(supabase, tripId, kind, payload) {
  if (!supabase || !tripId) return
  const { error } = await supabase.from('trip_events').insert({ trip_id: tripId, kind, payload })
  if (error) console.warn('[trip_events]', kind, error.message)
}

export async function loadGameDay(supabase) {
  if (!supabase) return null
  const iso = new Date().toISOString()
  const { data, error } = await supabase
    .from('game_day_events')
    .select('id, title, surge_multiplier, pickup_zone_label, starts_at, ends_at')
    .eq('active', true)
    .lte('starts_at', iso)
    .gte('ends_at', iso)
    .order('surge_multiplier', { ascending: false })
    .limit(1)
  if (error || !data?.length) return null
  return data[0]
}

export async function loadVehicle(supabase, driverId) {
  if (!supabase || !driverId) return null
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, make, model, color, plate, seats, is_tesla, autonomous_capable, tier')
    .eq('driver_id', driverId)
    .limit(1)
  if (error) throw new Error(error.message)
  return data?.[0] || null
}

export async function loadDriverProfile(supabase, driverId) {
  if (!supabase || !driverId) return null
  let res = await supabase
    .from('profiles')
    .select('id, full_name, phone, rating_avg, rating_count, student_verified_at, avatar_url')
    .eq('id', driverId)
    .maybeSingle()
  if (res.error && /rating_avg|rating_count|student_verified_at|column|schema cache/i.test(res.error.message || '')) {
    res = await supabase.from('profiles').select('id, full_name, phone, avatar_url').eq('id', driverId).maybeSingle()
  }
  if (res.error) throw new Error(res.error.message)
  return res.data
}

export function riderFacingCard({ profile, vehicle, online }) {
  const vehicleLabel = vehicle
    ? [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ')
    : 'Vehicle TBD'
  return {
    name: profile?.full_name || 'Driver',
    phone: profile?.phone || null,
    ratingAvg: profile?.rating_avg != null ? Number(profile.rating_avg) : null,
    ratingCount: Number(profile?.rating_count) || 0,
    studentVerified: Boolean(profile?.student_verified_at),
    vehicleLabel,
    plate: vehicle?.plate || null,
    isTesla: Boolean(vehicle?.is_tesla) || vehicle?.tier === 'tesla_self_driving',
    tier: vehicle?.tier || 'standard',
    online: Boolean(online),
    seats: vehicle?.seats || null,
  }
}

export async function setPriorityMode(supabase, driverId, on) {
  if (!supabase || !driverId) throw new Error('Sign in required')
  const { error } = await supabase.from('driver_status').upsert({
    driver_id: driverId,
    priority_mode: Boolean(on),
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

export async function publishDriverLocation(supabase, driverId, { lat, lng, heading = null, online = true }) {
  if (!supabase || !driverId) return
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  const { error } = await supabase.from('driver_status').upsert({
    driver_id: driverId,
    lat,
    lng,
    heading: Number.isFinite(Number(heading)) ? Number(heading) : null,
    online: Boolean(online),
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

export async function setTeslaListing(supabase, driverId, { enabled, claimModel3 = false }) {
  const vehicle = await loadVehicle(supabase, driverId)
  if (!vehicle?.id) throw new Error('Add your vehicle in driver onboarding before listing a Tesla.')
  const patch = {
    is_tesla: Boolean(enabled),
    autonomous_capable: false,
    tier: enabled ? 'tesla_self_driving' : 'standard',
  }
  if (enabled && claimModel3) {
    patch.make = 'Tesla'
    patch.model = 'Model 3'
  }
  const { data, error } = await supabase.from('vehicles').update(patch).eq('id', vehicle.id).select('*').single()
  if (error) throw new Error(error.message)
  return data
}

function cards(rows, gameDayLive) {
  return rows.map((row) => toDriverCard(row, { gameDayLive })).filter(Boolean)
}

export async function loadDriverDesk(supabase, driverId) {
  if (!supabase || !driverId) {
    return {
      offers: [],
      scheduledOpen: [],
      upcoming: [],
      active: null,
      online: false,
      priority: false,
      vehicle: null,
      gameDay: null,
      profile: null,
    }
  }
  const gameDay = await loadGameDay(supabase)
  const gameDayLive = Boolean(gameDay)
  const warnings = []
  const safeRows = async (label, finish) => {
    try {
      return await listTrips(supabase, finish)
    } catch (err) {
      warnings.push(`${label}: ${err.message}`)
      return []
    }
  }
  const [openRows, scheduledRows, mineRows, activeRows, statusRes, vehicle, profile] = await Promise.all([
    safeRows('offers', (query) => query.in('status', ['searching', 'offered', 'requested']).order('requested_at', { ascending: false }).limit(20)),
    safeRows('scheduled', (query) => query.eq('status', 'scheduled').is('driver_id', null).order('pickup_at', { ascending: true }).limit(25)),
    safeRows('upcoming', (query) => query.eq('driver_id', driverId).in('status', ['accepted', 'arriving']).not('pickup_at', 'is', null).order('pickup_at', { ascending: true }).limit(20)),
    safeRows('active', (query) => query.eq('driver_id', driverId).in('status', ['accepted', 'arriving', 'arrived', 'in_progress']).order('accepted_at', { ascending: false }).limit(8)),
    supabase.from('driver_status').select('online, priority_mode, lat, lng').eq('driver_id', driverId).maybeSingle(),
    loadVehicle(supabase, driverId).catch(() => null),
    loadDriverProfile(supabase, driverId).catch(() => null),
  ])
  if (statusRes.error) throw new Error(statusRes.error.message)

  const offers = cards(openRows, gameDayLive).filter((card) => {
    if (card.status === 'requested') return card.driverId === driverId
    return !card.driverId || card.driverId === driverId
  })
  const active = cards(activeRows, gameDayLive).find((card) => isDueNow(card)) || null
  const upcoming = cards(mineRows, gameDayLive).filter((card) => !isDueNow(card))
  return {
    offers,
    scheduledOpen: cards(scheduledRows, gameDayLive),
    upcoming,
    active,
    online: Boolean(statusRes.data?.online),
    priority: Boolean(statusRes.data?.priority_mode),
    lat: statusRes.data?.lat ?? null,
    lng: statusRes.data?.lng ?? null,
    vehicle,
    gameDay,
    profile,
    facing: riderFacingCard({ profile, vehicle, online: statusRes.data?.online }),
    warning: warnings[0] || null,
  }
}

export function subscribeTrips(supabase, onChange) {
  if (!supabase) return () => {}
  const channel = supabase
    .channel(`driver-trips-${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => onChange())
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}

export async function acceptTrip(supabase, trip, driverId) {
  if (!trip?.id) throw new Error('Missing ride')
  if (trip.status === 'scheduled') {
    const { data, error } = await supabase.rpc('accept_scheduled_trip', { p_trip_id: trip.id })
    if (error) throw new Error(error.message || 'Could not accept scheduled ride')
    return data
  }
  const acceptedAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('trips')
    .update({ status: 'accepted', driver_id: driverId, accepted_at: acceptedAt })
    .eq('id', trip.id)
    .in('status', ['requested', 'searching', 'offered'])
    .select('id, status, driver_id, accepted_at')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('That ride is no longer available')
  await writeTripEvent(supabase, trip.id, 'accepted', { driver_id: driverId, source: 'driver_app', accepted_at: acceptedAt })
  return data
}

export async function declineTrip(supabase, tripId) {
  if (!tripId) return
  const canceledAt = new Date().toISOString()
  const { error } = await supabase
    .from('trips')
    .update({ status: 'canceled', canceled_at: canceledAt })
    .eq('id', tripId)
    .in('status', ['requested', 'searching', 'offered'])
  if (error) throw new Error(error.message)
  await writeTripEvent(supabase, tripId, 'canceled', { reason: 'driver_decline', source: 'driver_app', canceled_at: canceledAt })
}

export async function advanceTrip(supabase, trip, driverId) {
  const next = nextTripStatus(trip?.status)
  if (!next || !trip?.id) throw new Error('This trip cannot be advanced')
  if (next === 'arrived') {
    try {
      await authedJson(supabase, '/api/driver?action=wait', {
        method: 'POST',
        body: { action: 'arrive', tripId: trip.id },
      })
    } catch (err) {
      if (!err.network && !err.unavailable) throw err
      const { error } = await supabase.from('trips').update({ status: 'arrived' }).eq('id', trip.id).eq('driver_id', driverId)
      if (error) throw new Error(error.message)
    }
    await writeTripEvent(supabase, trip.id, 'arrived', { driver_id: driverId, source: 'driver_app' })
    return { status: 'arrived' }
  }
  if (next === 'completed') {
    await authedJson(supabase, '/api/stripe-payment-methods?action=settle', {
      method: 'POST',
      body: { tripId: trip.id, action: 'complete' },
    })
  }
  const patch = { status: next }
  if (next === 'completed') patch.completed_at = new Date().toISOString()
  const { data, error } = await supabase
    .from('trips')
    .update(patch)
    .eq('id', trip.id)
    .eq('driver_id', driverId)
    .select('id, status, completed_at')
    .maybeSingle()
  if (error) {
    if (next === 'completed' && /payment_required/i.test(error.message || '')) {
      throw new Error('Payment is still required before this trip can complete.')
    }
    throw new Error(error.message)
  }
  if (!data || data.status !== next) {
    if (next === 'completed') {
      const again = await supabase.from('trips').select('id, status, completed_at').eq('id', trip.id).maybeSingle()
      if (again.data?.status === 'completed') return again.data
      throw new Error('Payment is still required before this trip can complete.')
    }
    throw new Error('Trip status did not update.')
  }
  await writeTripEvent(supabase, trip.id, next, { driver_id: driverId, from: trip.status, source: 'driver_app' })
  return data
}

export async function loadTrip(supabase, tripId, driverId) {
  if (!supabase || !tripId) return null
  const rows = await listTrips(supabase, (query) => query.eq('id', tripId).limit(1))
  const row = rows[0]
  if (!row) return null
  if (driverId && row.driver_id && row.driver_id !== driverId && !isActiveStatus(row.status) && row.status !== 'requested') {
    return toDriverCard(row)
  }
  return toDriverCard(row)
}

export async function loadEarnings(supabase, driverId) {
  if (!supabase || !driverId) {
    return { trips: [], paymentsByTrip: {}, payouts: null, summary: summarizeDepositAwareness([], {}), apiError: null, payoutError: null }
  }
  let tripRes = await supabase
    .from('trips')
    .select(EARNINGS_COLUMNS)
    .eq('driver_id', driverId)
    .in('status', ['completed', 'canceled'])
    .order('completed_at', { ascending: false })
    .limit(40)
  if (tripRes.error && /deposit_cents|column|schema cache/i.test(tripRes.error.message || '')) {
    tripRes = await supabase
      .from('trips')
      .select('id, status, fare_cents, dropoff_label, completed_at, pickup_label')
      .eq('driver_id', driverId)
      .in('status', ['completed', 'canceled'])
      .order('completed_at', { ascending: false })
      .limit(40)
  }
  if (tripRes.error) throw new Error(tripRes.error.message)
  const trips = tripRes.data || []
  let paymentsByTrip = {}
  let apiError = null
  try {
    const data = await authedJson(supabase, '/api/driver?action=earnings')
    paymentsByTrip = data.paymentsByTrip || {}
  } catch (err) {
    apiError = err.message || 'Earnings API unavailable'
  }
  let payouts = null
  let payoutError = null
  try {
    payouts = await authedJson(supabase, '/api/driver?action=payouts')
  } catch (err) {
    payoutError = err.message || 'Payout status unavailable'
  }
  return {
    trips,
    paymentsByTrip,
    payouts,
    summary: summarizeDepositAwareness(trips, paymentsByTrip),
    apiError,
    payoutError,
  }
}

export { formatCents }
