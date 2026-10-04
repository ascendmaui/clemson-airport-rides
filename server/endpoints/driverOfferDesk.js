/**
 * Driver-screen offer desk.
 * mark-offered: an approved online driver who can see the trip moves it
 * from searching to offered. driver_id stays empty so accept still races fairly.
 * pass-offer: the current target declines. Auto-assign moves to the next
 * online driver in the stored order. A picked driver returns the trip to the pool.
 * No email.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { driverApprovalStatus } from '../driverApproval.js'
import { listAssignableDrivers, nextQueuedDriver } from '../autoAssign.js'
import { offerVisibleToDriver } from '../../shared/driverOrder.js'

function metaOf(trip) {
  return trip?.metadata && typeof trip.metadata === 'object' && !Array.isArray(trip.metadata)
    ? trip.metadata
    : {}
}

async function caller(req, res, deps) {
  if (cors(req, res)) return null
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' })
    return null
  }
  const sb = deps.sb || admin()
  if (!sb) {
    json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
    return null
  }
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) {
    json(res, 401, { error: 'Sign in required' })
    return null
  }
  return { sb, user }
}

async function approvedOnline(sb, userId) {
  const gate = await driverApprovalStatus(sb, userId)
  if (gate.error) return { ok: false, status: 500, error: 'Could not check driver approval', code: 'driver_approval_unavailable' }
  if (!gate.approved) return { ok: false, status: 403, error: 'Finish approval to go online. Your account is still under review.', code: 'driver_not_approved' }
  const presence = await sb.from('driver_status').select('online').eq('driver_id', userId).maybeSingle()
  if (presence.error) return { ok: false, status: 500, error: 'Could not check online status', code: 'driver_status_unavailable' }
  if (!presence.data?.online) return { ok: false, status: 409, error: 'Go online before accepting a ride.', code: 'driver_offline' }
  return { ok: true }
}

async function loadTrip(sb, tripId) {
  const tripRes = await sb.from('trips').select('id, status, rider_id, driver_id, tier, metadata').eq('id', tripId).maybeSingle()
  if (tripRes.error) return { error: tripRes.error.message || 'Could not load trip', status: 500 }
  if (!tripRes.data) return { error: 'Trip not found', status: 404 }
  return { trip: tripRes.data }
}

export async function handleMarkOffered(req, res, deps = {}) {
  const ctx = await caller(req, res, deps)
  if (!ctx) return
  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  const tripId = String(body.tripId || '').trim()
  if (!tripId) return json(res, 400, { error: 'tripId required' })

  const ready = await approvedOnline(ctx.sb, ctx.user.id)
  if (!ready.ok) return json(res, ready.status, { error: ready.error, code: ready.code })

  const loaded = await loadTrip(ctx.sb, tripId)
  if (!loaded.trip) return json(res, loaded.status, { error: loaded.error })
  const trip = loaded.trip
  if (!offerVisibleToDriver(trip, ctx.user.id)) {
    return json(res, 403, { error: 'This ride offer is for another driver.', code: 'offer_not_yours' })
  }
  if (trip.status !== 'searching' || trip.driver_id) {
    return json(res, 200, { tripId, status: trip.status, unchanged: true })
  }

  const updated = await ctx.sb
    .from('trips')
    .update({ status: 'offered' })
    .eq('id', tripId)
    .eq('status', 'searching')
    .select('id, status')
    .maybeSingle()
  if (updated.error) return json(res, 500, { error: 'Could not update this ride offer', code: 'offer_update_failed' })
  return json(res, 200, { tripId, status: updated.data?.status || 'offered' })
}

export async function handlePassOffer(req, res, deps = {}) {
  const ctx = await caller(req, res, deps)
  if (!ctx) return
  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  const tripId = String(body.tripId || '').trim()
  if (!tripId) return json(res, 400, { error: 'tripId required' })

  const ready = await driverApprovalStatus(ctx.sb, ctx.user.id)
  if (ready.error) return json(res, 500, { error: 'Could not check driver approval', code: 'driver_approval_unavailable' })
  if (!ready.approved) return json(res, 403, { error: 'Finish approval to go online. Your account is still under review.', code: 'driver_not_approved' })

  const loaded = await loadTrip(ctx.sb, tripId)
  if (!loaded.trip) return json(res, loaded.status, { error: loaded.error })
  const trip = loaded.trip
  if (!['searching', 'offered'].includes(trip.status)) {
    return json(res, 200, { tripId, status: trip.status, unchanged: true })
  }
  const meta = metaOf(trip)
  const target = typeof meta.offer_driver_id === 'string' ? meta.offer_driver_id : ''
  if (target && target !== ctx.user.id) {
    return json(res, 403, { error: 'This ride offer is for another driver.', code: 'offer_not_yours' })
  }

  let offerDriverId = null
  if (meta.match === 'auto' && Array.isArray(meta.auto_assign_queue)) {
    const ordered = await listAssignableDrivers(ctx.sb, { tier: trip.tier === 'tesla' ? 'tesla' : 'standard' })
    if (ordered.error) return json(res, 500, { error: 'Could not read online drivers', code: 'driver_status_unavailable' })
    offerDriverId = nextQueuedDriver(
      meta.auto_assign_queue,
      ctx.user.id,
      ordered.drivers.map((driver) => driver.id),
    )
  }

  const nextMeta = {
    ...meta,
    offer_driver_id: offerDriverId,
    match: offerDriverId ? meta.match || 'auto' : 'open',
  }
  const updated = await ctx.sb
    .from('trips')
    .update({
      status: 'searching',
      driver_id: null,
      metadata: nextMeta,
    })
    .eq('id', tripId)
    .in('status', ['searching', 'offered'])
    .select('id, status, metadata')
    .maybeSingle()
  if (updated.error) return json(res, 500, { error: 'Could not pass this ride offer', code: 'offer_update_failed' })
  return json(res, 200, {
    tripId,
    status: updated.data?.status || 'searching',
    offerDriverId,
    released: !offerDriverId,
  })
}
