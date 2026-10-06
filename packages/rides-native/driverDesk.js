/**
 * Driver desk: availability, PickDriver requests, scheduled queue, live status.
 * Payments go through the existing /api/driver and /api/stripe-payment-methods routers.
 */
import { offerVisibleToDriver, visibleOfferQuery, unchangedOfferQuery } from '../../shared/driverOrder.js'
import { filterVisibleTrips, pairAllowedByRpc, visibleTripIdSet, WOMEN_ONLY_ACCEPT_ERROR } from './comfortPreference.js'
import { isStaleLiveOffer } from '../../shared/staleLiveOffer.js'
import { lockedOfferEconomics } from './offerLadder.js'
import { missingVehicleYearColumn } from '../../shared/vehicleYear.js'
import { vehicleServesComfort } from '../../shared/rideOptions.js'
import { authedJson } from './apiClient.js'
import { approvalGateMessage } from './syntheticOffers.js'
import {
  acceptNeedsDriverOnline,
  declineDisposition,
  formatCents,
  isActiveStatus,
  isDueNow,
  isUnpaidAirportDepositTrip,
  nextTripStatus,
  UNPAID_AIRPORT_DEPOSIT_ACCEPT_ERROR,
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
  'created_at',
  'requested_at',
  'offer_expires_at',
].join(', ')

const EARNINGS_COLUMNS = 'id, status, fare_cents, deposit_cents, dropoff_label, completed_at, pickup_label, metadata'

async function listTrips(supabase, finish) {
  const run = async (columns) => finish(supabase.from('trips').select(columns))
  let columns = TRIP_COLUMNS
  let res = await run(columns)
  if (res.error && /offer_expires_at|requested_at|created_at/i.test(res.error.message || '')) {
    columns = columns.replace(/, created_at|, requested_at|, offer_expires_at/g, '')
    res = await run(columns)
  }
  if (res.error && /deposit_cents|column|schema cache/i.test(res.error.message || '')) {
    res = await run(columns.replace('deposit_cents, ', ''))
  }
  if (res.error) throw new Error(res.error.message)
  return res.data || []
}

async function writeTripEvent(supabase, tripId, kind, payload) {
  if (!supabase || !tripId) return
  const { error } = await supabase.from('trip_events').insert({ trip_id: tripId, kind, payload })
  if (error) {
    console.error('[trip_events]', kind, error.message)
    throw new Error(error.message || `Could not record trip event (${kind})`)
  }
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
  const withYear = 'id, year, make, model, color, plate, seats, service_class, autonomous_capable, tier'
  const base = 'id, make, model, color, plate, seats, service_class, autonomous_capable, tier'
  let res = await supabase.from('vehicles').select(withYear).eq('driver_id', driverId).limit(1)
  if (res.error && missingVehicleYearColumn(res.error)) {
    res = await supabase.from('vehicles').select(base).eq('driver_id', driverId).limit(1)
  }
  if (res.error) throw new Error(res.error.message)
  return res.data?.[0] || null
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
  const vehicleLabel = [vehicle?.color, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || 'Vehicle TBD'
  return {
    name: profile?.full_name || 'Driver',
    phone: profile?.phone || null,
    ratingAvg: profile?.rating_avg != null ? Number(profile.rating_avg) : null,
    ratingCount: Number(profile?.rating_count) || 0,
    studentVerified: Boolean(profile?.student_verified_at),
    vehicleLabel,
    plate: vehicle?.plate || null,
    comfortClass: vehicleServesComfort(vehicle),
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
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return
  const { error } = await supabase.from('driver_status').upsert({
    driver_id: driverId,
    lat,
    lng,
    heading: Number.isFinite(Number(heading)) ? Number(heading) : null,
    online: Boolean(online),
    updated_at: new Date().toISOString(),
    location_updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

export async function setServiceClass(supabase, driverId, serviceClass) {
  const vehicle = await loadVehicle(supabase, driverId)
  if (!vehicle?.id) throw new Error('Add your vehicle in driver onboarding before choosing a service class.')
  const service_class = serviceClass === 'comfort' ? 'comfort' : 'standard'
  const { data, error } = await supabase.from('vehicles').update({ service_class, tier: service_class }).eq('id', vehicle.id).select('*').single()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Open-offer values the trip_status enum accepts.
 * "requested" is not in the enum. A filter that includes it fails the whole query.
 */
const OPEN_OFFER_STATUSES = ['searching', 'offered']

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
  const [openRows, scheduledRows, mineRows, activeRows, statusRes, vehicle, profile, appRes] = await Promise.all([
    safeRows('offers', (query) => visibleOfferQuery(query.in('status', OPEN_OFFER_STATUSES), driverId).order('requested_at', { ascending: false }).limit(20)),
    safeRows('scheduled', (query) => query.eq('status', 'scheduled').is('driver_id', null).order('pickup_at', { ascending: true }).limit(25)),
    safeRows('upcoming', (query) => query.eq('driver_id', driverId).in('status', ['accepted', 'arriving']).not('pickup_at', 'is', null).order('pickup_at', { ascending: true }).limit(20)),
    safeRows('active', (query) => query.eq('driver_id', driverId).in('status', ['accepted', 'arriving', 'arrived', 'in_progress']).order('accepted_at', { ascending: false }).limit(8)),
    supabase.from('driver_status').select('online, priority_mode, lat, lng').eq('driver_id', driverId).maybeSingle(),
    loadVehicle(supabase, driverId).catch(() => null),
    loadDriverProfile(supabase, driverId).catch(() => null),
    supabase.from('driver_applications').select('onboarding_status').eq('profile_id', driverId).maybeSingle(),
  ])
  if (statusRes.error) throw new Error(statusRes.error.message)

  const approvedForOffers = !appRes.error && appRes.data?.onboarding_status === 'approved'
  if (appRes.error) warnings.push(`approval: ${appRes.error.message}`)
  const approvalGate = approvedForOffers ? null : approvalGateMessage()

  const passedIds = approvedForOffers
    ? new Set(await listPassedTripIds(supabase, driverId))
    : new Set()
  const claimableOpen = approvedForOffers
    ? openRows.filter((row) => (
      offerVisibleToDriver(row, driverId)
      && !isUnpaidAirportDepositTrip(row)
      && !isStaleLiveOffer(row)
    ))
    : []
  const claimableScheduled = approvedForOffers
    ? scheduledRows.filter((row) => !isUnpaidAirportDepositTrip(row))
    : []
  const comfortIds = await visibleTripIdSet(supabase, [...claimableOpen, ...claimableScheduled].map((row) => row.id))
  const comfortOpen = filterVisibleTrips(claimableOpen, comfortIds)
  const comfortScheduled = filterVisibleTrips(claimableScheduled, comfortIds)
  const offers = cards(comfortOpen, gameDayLive).filter((card) => {
    if (card.status !== 'requested' && passedIds.has(card.id)) return false
    if (card.status === 'requested') return card.driverId === driverId
    if ((card.status === 'searching' || card.status === 'offered') && !isDueNow(card)) return false
    return !card.driverId || card.driverId === driverId
  })
  const active = cards(activeRows, gameDayLive).find((card) => isDueNow(card)) || null
  const upcoming = cards(mineRows, gameDayLive).filter((card) => !isDueNow(card))
  return {
    offers,
    scheduledOpen: cards(comfortScheduled, gameDayLive),
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
    approvalGate,
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

export async function listPassedTripIds(supabase, driverId) {
  if (!supabase || !driverId) return []
  const { data, error } = await supabase
    .from('driver_offer_passes')
    .select('trip_id')
    .eq('driver_id', driverId)
  if (error) return []
  return (data || []).map((row) => row.trip_id).filter(Boolean)
}

async function rememberPass(supabase, tripId, driverId) {
  let id = driverId
  if (!id) {
    const auth = await supabase.auth.getUser()
    id = auth.data?.user?.id || null
  }
  if (!id || !tripId) return false
  const { error } = await supabase.from('driver_offer_passes').upsert({ driver_id: id, trip_id: tripId })
  if (error) {
    console.warn('[pass]', error.message)
    return false
  }
  return true
}
export async function acceptTrip(supabase, trip, driverId) {
  if (!trip?.id) throw new Error('Missing ride')
  if (trip.isSynthetic === true || String(trip.id).startsWith('synthetic-')) {
    throw new Error('Finish approval to go online. Your account is still under review.')
  }
  const freshRows = await listTrips(supabase, (query) => query.eq('id', trip.id).limit(1))
  const fresh = freshRows[0]
  if (!fresh) {
    throw new Error("That ride is no longer available")
  }
  if (fresh.driver_id && fresh.driver_id !== driverId) throw new Error('That ride is no longer available')
  if (fresh.status && !['requested', 'searching', 'offered', 'scheduled'].includes(fresh.status)) {
    throw new Error('That ride is no longer available')
  }
  // trips.update and accept_scheduled_trip both hit
  // trips_block_unpaid_airport_deposit_accept. This is the desk copy of that error.
  if (isUnpaidAirportDepositTrip(fresh)) {
    throw new Error(UNPAID_AIRPORT_DEPOSIT_ACCEPT_ERROR)
  }
  const gate = await supabase
    .from('driver_applications')
    .select('onboarding_status')
    .eq('profile_id', driverId)
    .maybeSingle()
  if (gate.error) throw new Error(gate.error.message)
  if (gate.data?.onboarding_status !== 'approved') {
    throw new Error('Finish approval to go online. Your account is still under review.')
  }
  // The card can be stale by the time a driver taps Accept. Use the row we
  // just re-read so a changed status cannot select the scheduled-RPC path or
  // bypass the on-demand online-presence gate.
  if (acceptNeedsDriverOnline(fresh.status)) {
    const presence = await supabase.from('driver_status').select('online').eq('driver_id', driverId).maybeSingle()
    if (presence.error) throw new Error(presence.error.message)
    if (!presence.data?.online) throw new Error('Go online before accepting a ride.')
  }
  // Re-fetch the trip to get the latest state after any potential changes
  // from checking the driver's online status (e.g., metadata offer_driver_id may have changed).
  const freshRowsAfter = await listTrips(supabase, (query) => query.eq('id', trip.id).limit(1))
  const freshAfter = freshRowsAfter[0]
  if (!freshAfter) {
    throw new Error("That ride is no longer available")
  }
  if (freshAfter.driver_id && freshAfter.driver_id !== driverId) throw new Error('That ride is no longer available')
  if (freshAfter.status && !['requested', 'searching', 'offered', 'scheduled'].includes(freshAfter.status)) {
    throw new Error('That ride is no longer available')
  }
  if (freshAfter.metadata?.offer_driver_id && freshAfter.metadata.offer_driver_id !== driverId) {
    throw new Error("That ride is no longer available")
  }
  // If the trip is scheduled, we need to update the trip's status to 'accepted'
  // and set the accepted_at timestamp.
  let data;
  if (freshAfter.status === 'scheduled') {
    // Call RPC for scheduled trips
    const { data: rpcData, error: rpcError } = await supabase.rpc('accept_scheduled_trip', { p_trip_id: trip.id })
    if (rpcError) throw rpcError
    // Write the accepted event
    await writeTripEvent(supabase, trip.id, 'accepted', { driver_id: driverId, source: 'driver_app', accepted_at: new Date().toISOString() })
    data = rpcData
  } else {
    // For on-demand trips, we update the trip's status to 'accepted', set the
    // accepted_at timestamp, and set the driver_id.
    const { data: dataResult, error } = await supabase
      .from('trips')
      .update({ status: 'accepted', accepted_at: new Date().toISOString(), driver_id: driverId })
      .eq('id', trip.id)
      .in('status', ['requested', 'searching', 'offered'])
      .eq('driver_id', null)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!dataResult) throw new Error('That ride is no longer available')
    // Write the accepted event for on-demand trips
    await writeTripEvent(supabase, trip.id, 'accepted', { driver_id: driverId, source: 'driver_app', accepted_at: new Date().toISOString() })
    data = dataResult;
  }
  return data
}
export async function publishDriverCapacity(supabase, driverId, seats) {
  if (!supabase || !driverId) return { seats: null, stored: false }
  const count = Math.max(1, Math.round(Number(seats) || 0))
  if (!count) return { seats: null, stored: false }
  const row = { driver_id: driverId, seats: count, updated_at: new Date().toISOString() }
  const first = await supabase.from('driver_status').upsert(row)
  if (!first.error) return { seats: count, stored: true }
  if (/seats|column|schema cache/i.test(first.error.message || '')) return { seats: count, stored: false }
  throw new Error(first.error.message)
}

export async function declineTrip(supabase, tripOrId, driverId = null) {
  const trip = typeof tripOrId === 'string' ? { id: tripOrId, status: 'requested' } : tripOrId
  if (!trip?.id) return { disposition: 'leave' }
  const disposition = declineDisposition(trip.status)
  if (disposition === 'leave') return { disposition }
  if (disposition === 'release') {
    // Immediate matching passes retarget atomically through the pass-table trigger.
    // Open-pool rows stay driver_id null. RLS only lets an online driver claim
    // them (accepted or offered with their own id), so a decline cannot rewrite
    // the trip back to searching. Record a pass and leave it in the pool.
    const matching = trip.matchingOffer || (trip.metadata?.kind === 'driver_request'
      && !trip.pickup_at && !trip.scheduled_for && !Number(trip.deposit_cents || 0))
    const passed = await rememberPass(supabase, trip.id, driverId)
    let released = false
    if (trip.status === 'offered' && !matching) {
      const { data, error } = await supabase
        .from('trips')
        .update({ status: 'searching', driver_id: null })
        .eq('id', trip.id)
        .eq('status', 'offered')
        .is('driver_id', null)
        .select('id')
        .maybeSingle()
      if (error && !passed) throw new Error(error.message)
      released = Boolean(data)
    }
    if (!passed && !released) {
      throw new Error('Could not pass on this ride. It is still in the open pool.')
    }
    if (passed && matching) {
      return { disposition, passed, released }
    }
    await writeTripEvent(supabase, trip.id, 'released', {
      reason: 'driver_decline',
      source: 'driver_app',
      passed,
      released,
    })
    return { disposition, passed, released }
  }
  const canceledAt = new Date().toISOString()
  const { error } = await supabase
    .from('trips')
    .update({ status: 'canceled', canceled_at: canceledAt })
    .eq('id', trip.id)
    .in('status', OPEN_OFFER_STATUSES)
  if (error) throw new Error(error.message)
  await writeTripEvent(supabase, trip.id, 'canceled', { reason: 'driver_decline', source: 'driver_app', canceled_at: canceledAt })
  return { disposition: 'cancel' }
}

export async function loadRiderFix(supabase, tripId) {
  if (!supabase || !tripId) return null
  try {
    const share = await supabase
      .from('location_shares')
      .select('id')
      .eq('trip_id', tripId)
      .eq('active', true)
      .maybeSingle()
    if (share.error || !share.data?.id) return null
    const point = await supabase
      .from('location_points')
      .select('lat, lng, created_at')
      .eq('share_id', share.data.id)
      .order('created_at', { ascending: false })
      .limit(1)
    const row = point.data?.[0]
    if (point.error || !row) return null
    const latitude = Number(row.lat)
    const longitude = Number(row.lng)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
    return { latitude, longitude, updatedAt: row.created_at || null }
  } catch {
    return null
  }
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
  let settle = null
  if (next === 'completed') {
    settle = await authedJson(supabase, '/api/stripe-payment-methods?action=settle', {
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
  return settle ? { ...data, settle } : data
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
      .select('id, status, fare_cents, dropoff_label, completed_at, pickup_label, metadata')
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
