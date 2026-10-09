import { uniqueChannelTopic } from './realtimeChannel.js'
/**
 * Driver desk: availability, PickDriver requests, scheduled queue, live status.
 * Payments go through the existing /api/driver and /api/stripe-payment-methods routers.
 */
import { offerVisibleToDriver, visibleOfferQuery } from '../../shared/driverOrder.js'
import { filterVisibleTrips, pairAllowedByRpc, visibleTripIdSet, WOMEN_ONLY_ACCEPT_ERROR } from './comfortPreference.js'
import { isStaleLiveOffer } from '../../shared/staleLiveOffer.js'
import { lockedOfferEconomics } from './offerLadder.js'
import { compareBoostedFirst } from '../../shared/scheduledBoost.js'
import { missingVehicleYearColumn } from '../../shared/vehicleYear.js'
import { vehicleServesComfort } from '../../shared/rideOptions.js'
import { headingOrNull, isLiveLocationStatus, speedOrNull } from './liveFix.js'
import { authedJson } from './apiClient.js'
import { driverBackupPresentation, isBackupQueueRide } from '../../shared/backupDriverQueue.js'
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
  'wait_fee_cents',
  'cancel_fee_cents',
  'driver_wait_earnings_cents',
  'canceled_at',
  'completed_at',
  'created_at',
  'requested_at',
  'offer_expires_at',
].join(', ')

const EARNINGS_COLUMNS = 'id, status, canceled_at, wait_fee_cents, cancel_fee_cents, driver_wait_earnings_cents, fare_cents, deposit_cents, dropoff_label, completed_at, pickup_label, metadata'

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

export async function publishDriverLocation(supabase, driverId, {
  lat,
  lng,
  heading = null,
  online = true,
  speed = null,
  tripId = null,
  tripStatus = null,
} = {}) {
  if (!supabase || !driverId) return
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  const now = new Date().toISOString()
  const { error } = await supabase.from('driver_status').upsert({
    driver_id: driverId,
    lat,
    lng,
    heading: Number.isFinite(Number(heading)) ? Number(heading) : null,
    online: Boolean(online),
    updated_at: now,
    location_updated_at: now,
  })
  if (error) throw new Error(error.message)

  let liveTripId = tripId || null
  let liveStatus = tripStatus || null
  if (!liveTripId) {
    const active = await supabase
      .from('trips')
      .select('id, status')
      .eq('driver_id', driverId)
      .in('status', ['accepted', 'arriving', 'arrived', 'in_progress'])
      .order('accepted_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!active.error && active.data?.id) {
      liveTripId = active.data.id
      liveStatus = active.data.status || null
    }
  }
  if (!liveTripId || !isLiveLocationStatus(liveStatus)) return
  const tripWrite = await supabase.from('trip_driver_locations').upsert({
    trip_id: liveTripId,
    driver_id: driverId,
    lat,
    lng,
    heading: headingOrNull(heading),
    speed: speedOrNull(speed),
    updated_at: now,
  })
  if (tripWrite.error) throw new Error(tripWrite.error.message)
}

function serviceClassFromInput(serviceClass) {
  if (serviceClass === 'comfort') return 'comfort'
  if (serviceClass && typeof serviceClass === 'object' && serviceClass.enabled === true) return 'comfort'
  return 'standard'
}

export async function setServiceClass(supabase, driverId, serviceClass) {
  const vehicle = await loadVehicle(supabase, driverId)
  if (!vehicle?.id) throw new Error('Add your vehicle in driver onboarding before choosing a service class.')
  const service_class = serviceClassFromInput(serviceClass)
  const { data, error } = await supabase.from('vehicles').update({ service_class, tier: service_class }).eq('id', vehicle.id).select('*').single()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Open-offer values the trip_status enum accepts.
 * "requested" is not in the enum. A filter that includes it fails the whole query.
 */
const OPEN_OFFER_STATUSES = ['searching', 'offered']

function cards(rows, gameDayLive, driverId) {
  return rows.map((row) => toDriverCard(row, { gameDayLive, driverId })).filter(Boolean)
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
  const backupSeat = (row) => driverBackupPresentation(row, driverId)
  const scheduledPool = comfortScheduled.filter((row) => {
    const seat = backupSeat(row)
    if (!seat) return true
    return seat.role === 'open_primary' || seat.role === 'open_backup'
  })
  const myBackupSeats = comfortScheduled.filter((row) => {
    const seat = backupSeat(row)
    return seat?.role === 'primary' || seat?.role === 'backup'
  })
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
    scheduledOpen: cards(scheduledPool, gameDayLive, driverId).sort(compareBoostedFirst),
    upcoming: [...upcoming, ...cards(myBackupSeats, gameDayLive, driverId)],
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
    .channel(uniqueChannelTopic('driver-trips'))
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

async function lockAcceptedShare(supabase, fresh, driverId) {
  const economics = lockedOfferEconomics(fresh)
  if (!economics || !supabase || !fresh?.id) return
  try {
    await supabase.from('trips').update({
      driver_earnings_cents: economics.netCents,
      platform_fee_cents: economics.platformFeeCents,
      metadata: {
        ...(fresh.metadata || {}),
        driver_share_bps: economics.shareBps,
        driver_payout_cents: economics.netCents,
        accepted_offer_phase: economics.phase,
      },
    }).eq('id', fresh.id).eq('driver_id', driverId)
  } catch {
    /* The accept already committed. Earnings stay on the classic split until a retry. */
  }
}

export async function confirmBackupQueueTrip(supabase, tripId, { navigate = false } = {}) {
  if (!tripId) throw new Error('Missing ride')
  return authedJson(supabase, '/api/driver?action=backup-queue', {
    method: 'POST',
    body: { op: navigate ? 'navigate' : 'confirm', tripId, navigate },
  })
}

/** Primary cancel promotes the backup. A backup who leaves reopens that seat. */
export async function releaseBackupQueueSeat(supabase, tripId, { role = 'primary' } = {}) {
  if (!tripId) throw new Error('Missing ride')
  const op = role === 'backup' ? 'release' : 'cancel'
  return authedJson(supabase, '/api/driver?action=backup-queue', {
    method: 'POST',
    body: { op, tripId },
  })
}

export async function acceptTrip(supabase, trip, driverId) {
  if (!trip?.id) throw new Error('Missing ride')
  if (trip.isSynthetic === true || String(trip.id).startsWith('synthetic-')) {
    throw new Error('Finish approval to go online. Your account is still under review.')
  }
  const freshRows = await listTrips(supabase, (query) => query.eq('id', trip.id).limit(1))
  const fresh = freshRows[0]
  if (!fresh || !offerVisibleToDriver(fresh, driverId)) throw new Error('That ride is no longer available')
  if (fresh.status && !['requested', 'searching', 'offered', 'scheduled'].includes(fresh.status)) {
    throw new Error('That ride is no longer available')
  }
  const comfortAllowed = await pairAllowedByRpc(supabase, fresh.rider_id, driverId)
  if (comfortAllowed === false) throw new Error(WOMEN_ONLY_ACCEPT_ERROR)
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
  if (fresh.status === 'scheduled' && isBackupQueueRide(fresh)) {
    const data = await authedJson(supabase, '/api/driver?action=backup-queue', {
      method: 'POST',
      body: { op: 'accept', tripId: trip.id },
    })
    if (data?.useScheduledRpc) {
      const accepted = await supabase.rpc('accept_scheduled_trip', { p_trip_id: trip.id })
      if (accepted.error) throw new Error(accepted.error.message || 'Could not accept scheduled ride')
      await lockAcceptedShare(supabase, fresh, driverId)
      return accepted.data
    }
    return data
  }
  if (fresh.status === 'scheduled') {
    const { data, error } = await supabase.rpc('accept_scheduled_trip', { p_trip_id: trip.id })
    if (error) throw new Error(error.message || 'Could not accept scheduled ride')
    await lockAcceptedShare(supabase, fresh, driverId)
    return data
  }
  const result = await driverTripAction(supabase, trip.id, 'accept')
  return result.trip
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

const markedSearchingOffers = new Set()

/** Promote visible searching rows to offered. The client update fails RLS. */
export async function markSearchingOffers(supabase, offers) {
  if (!supabase) return
  const pending = []
  for (const card of offers || []) {
    if (!card?.id || card.status !== 'searching' || card.driverId) continue
    if (markedSearchingOffers.has(card.id)) continue
    markedSearchingOffers.add(card.id)
    pending.push(
      authedJson(supabase, '/api/driver?action=mark-offered', {
        method: 'POST',
        body: { tripId: card.id },
      }).catch(() => {
        markedSearchingOffers.delete(card.id)
      }),
    )
  }
  await Promise.all(pending)
}

export async function passOffer(supabase, tripId) {
  if (!supabase || !tripId) throw new Error('Missing ride')
  return authedJson(supabase, '/api/driver?action=pass-offer', {
    method: 'POST',
    body: { tripId },
  })
}

/**
 * Live matching declines go through pass-offer so the next driver is notified.
 * If that call fails, the local pass still records the decline.
 */
export async function declineDriverOffer(supabase, trip, driverId = null) {
  if (trip?.matchingOffer && trip?.id) {
    try {
      const result = await passOffer(supabase, trip.id)
      return { disposition: 'release', passed: true, via: 'api', result }
    } catch {
      /* The offer API is down. Record the pass on this phone. */
    }
  }
  return declineTrip(supabase, trip, driverId)
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

export async function tripWaitTick(supabase, tripId) {
  if (!tripId) throw new Error('Missing ride')
  return authedJson(supabase, '/api/driver?action=wait', {
    method: 'POST', body: { action: 'tick', tripId },
  })
}

export async function driverTripAction(supabase, tripId, op) {
  if (!tripId) throw new Error('Missing ride')
  try {
    return await authedJson(supabase, '/api/driver?action=trip-status', {
      method: 'POST', body: { tripId, op },
    })
  } catch (err) {
    if (op === 'complete' && (err.status === 402 || /payment_required/i.test(err.message || ''))) {
      err.message = 'Payment is still required before this trip can complete.'
    }
    throw err
  }
}

export async function driverCancelTrip(supabase, tripId, reason, note) {
  if (!tripId) throw new Error('Missing ride')
  return authedJson(supabase, '/api/driver?action=trip-status', {
    method: 'POST', body: { tripId, op: 'driver-cancel', reason, ...(note ? { note } : {}) },
  })
}

export async function advanceTrip(supabase, trip, driverId) {
  const next = nextTripStatus(trip?.status)
  const op = { arriving: 'arriving', arrived: 'arrive', in_progress: 'start', completed: 'complete' }[next]
  if (!op || !trip?.id) throw new Error('This trip cannot be advanced')
  const result = await driverTripAction(supabase, trip.id, op)
  return { ...result.trip, ...(result.settle ? { settle: result.settle } : {}), ...(result.wait ? { wait: result.wait } : {}), ...(result.idempotent ? { idempotent: true } : {}) }
}

export async function loadTrip(supabase, tripId, driverId) {
  if (!supabase || !tripId) return null
  const rows = await listTrips(supabase, (query) => query.eq('id', tripId).limit(1))
  const row = rows[0]
  if (!row) return null
  if (driverId && row.driver_id && row.driver_id !== driverId && !isActiveStatus(row.status) && row.status !== 'requested') {
    return toDriverCard(row, { driverId })
  }
  return toDriverCard(row, { driverId })
}

export async function loadEarnings(supabase, driverId) {
  if (!supabase || !driverId) {
    return { trips: [], paymentsByTrip: {}, payouts: null, summary: summarizeDepositAwareness([], {}), apiError: null, payoutError: null }
  }
  let tripRes = await supabase
    .from('trips')
    .select(EARNINGS_COLUMNS)
    .eq('driver_id', driverId)
    .in('status', ['completed', 'canceled', 'cancelled_wait'])
    .order('completed_at', { ascending: false })
    .limit(40)
  if (tripRes.error && /deposit_cents|column|schema cache/i.test(tripRes.error.message || '')) {
    tripRes = await supabase
      .from('trips')
      .select('id, status, fare_cents, canceled_at, wait_fee_cents, cancel_fee_cents, driver_wait_earnings_cents, dropoff_label, completed_at, pickup_label, metadata')
      .eq('driver_id', driverId)
      .in('status', ['completed', 'canceled', 'cancelled_wait'])
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
