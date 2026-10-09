import { openPoolRerequestPatch, validateDriverCancel } from '../shared/driverCancel.js'
import { resolveDriverTransition } from '../shared/tripTransitions.js'
import { poolDeadlineIso } from '../packages/rides-native/offerLadder.js'
import { offerVisibleToDriver, unchangedOfferQuery } from '../shared/driverOrder.js'
import { listAssignableDrivers } from './autoAssign.js'
import { notifyDriverOffer } from './driverOfferAlerts.js'
import { insertTripEvent } from './tripEvents.js'

function cancelsOf(trip) {
  return Array.isArray(trip?.metadata?.driver_cancels) ? trip.metadata.driver_cancels : []
}

function replayBy(trip, driverId) {
  return cancelsOf(trip).some((entry) => entry?.driver_id === driverId)
}

async function stopTripSharing(sb, tripId, driverId, at) {
  // Same share revocation as midride cancellation; remove the old car fix too.
  const shares = await sb.from('location_shares').update({ active: false, revoked_at: at })
    .eq('trip_id', tripId).eq('active', true)
  const fix = await sb.from('trip_driver_locations').delete().eq('trip_id', tripId).eq('driver_id', driverId)
  if (shares.error || fix.error) throw shares.error || fix.error
}

async function alertPool(sb, trip, at, deps) {
  const eligible = await (deps.listAssignableDrivers || listAssignableDrivers)(sb, { tier: trip.tier || 'standard', riderId: trip.rider_id })
  if (eligible.error) throw new Error(eligible.error)
  const passes = await sb.from('driver_offer_passes').select('driver_id').eq('trip_id', trip.id)
  if (passes.error) throw passes.error
  const passed = new Set((passes.data || []).map((row) => row.driver_id))
  for (const driver of eligible.drivers || []) {
    if (!offerVisibleToDriver(trip, driver.id) || passed.has(driver.id)) continue
    await (deps.notifyDriverOffer || notifyDriverOffer)(sb, { trip, driverId: driver.id, offerMarker: `pool:${at}` })
  }
}

/** No Stripe operation: the same ride and fare hold continue with another driver. */
export async function cancelDriverTrip(sb, user, trip, body, deps = {}) {
  const fail = (status, code, error) => ({ status, body: { ok: false, code, error } })
  if (trip.rider_id === user.id || (trip.driver_id !== user.id && !replayBy(trip, user.id))) {
    return fail(403, 'forbidden', 'Not allowed on this trip')
  }
  if (trip.driver_id !== user.id && replayBy(trip, user.id)) {
    return { status: 200, body: { ok: true, idempotent: true } }
  }
  if (trip.scheduled_for || trip.pickup_at) return fail(409, 'scheduled_use_backup', "Use Can't make this trip in the backup queue for scheduled rides.")
  if (resolveDriverTransition({ status: trip.status, op: 'driver-cancel' }).error) {
    return fail(409, 'invalid_transition', 'Cancel trip is available before arrival at pickup.')
  }
  const invalid = validateDriverCancel(body.reason, body.note)
  if (invalid) return fail(400, 'invalid_reason', invalid)
  const at = deps.now || new Date().toISOString()
  const record = { driver_id: user.id, reason: body.reason, note: body.note?.trim() || null, at, from_status: trip.status }
  const patch = openPoolRerequestPatch(trip, at)
  patch.offer_expires_at = poolDeadlineIso(at)
  patch.metadata.driver_cancels = [...cancelsOf(trip), record]
  const saved = await unchangedOfferQuery(sb.from('trips').update(patch), trip).eq('id', trip.id)
    .eq('driver_id', user.id).in('status', ['accepted', 'arriving'])
    // Keep concurrent metadata/hold edits rather than overwriting them.
    .select('*').maybeSingle()
  if (saved.error) throw saved.error
  if (!saved.data) {
    const fresh = await sb.from('trips').select('*').eq('id', trip.id).maybeSingle()
    if (fresh.error) throw fresh.error
    if (replayBy(fresh.data, user.id)) return { status: 200, body: { ok: true, idempotent: true } }
    return fail(409, 'transition_conflict', 'This ride changed. Refresh and try again.')
  }
  const event = await insertTripEvent(sb, { trip_id: trip.id, kind: 'driver_canceled', payload: record })
  await stopTripSharing(sb, trip.id, user.id, at)
  try {
    await alertPool(sb, saved.data, at, deps)
  } catch (error) {
    // Realtime offers are already visible; the matching cron remains the fallback.
    console.error('[driver-cancel] offer alerts', trip.id, error.message)
  }
  return { status: 200, body: { ok: true, trip: saved.data, ...(event.error ? { eventWarning: event.error.message } : {}) } }
}
