/**
 * Assigned driver ends an active trip and reports a problem.
 * The pre-auth hold is released. The fare is never captured.
 */
import { releaseOpenFareHold } from './fareAuthorization.js'
import { insertTripEvent } from './tripEvents.js'
import {
  DRIVER_END_STATUSES,
  validateDriverEnd,
} from '../shared/driverEndTrip.js'

const ALREADY_ENDED = new Set(['canceled', 'cancelled', 'canceled_midride', 'cancelled_wait', 'expired'])

function metaOf(trip) {
  const meta = trip?.metadata
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}
}

function endedBy(trip, driverId) {
  const record = metaOf(trip).driver_end
  return Boolean(record && record.driver_id === driverId)
}

export async function recordTripHeartbeat(sb, user, trip, { now = new Date().toISOString() } = {}) {
  const fail = (status, code, error) => ({ status, body: { ok: false, code, error } })
  if (!user?.id) return fail(401, 'auth_required', 'Sign in required')
  if (!trip) return fail(404, 'trip_not_found', 'Trip not found')
  const isDriver = trip.driver_id === user.id
  const isRider = trip.rider_id === user.id
  if (!isDriver && !isRider) return fail(403, 'forbidden', 'Not allowed on this trip')
  if (!DRIVER_END_STATUSES.includes(trip.status)) return fail(409, 'invalid_transition', 'This trip is not active')
  const patch = {}
  if (isDriver) patch.driver_heartbeat_at = now
  if (isRider) patch.rider_heartbeat_at = now
  const saved = await sb.from('trips').update(patch).eq('id', trip.id).eq('status', trip.status)
  if (saved?.error) {
    if (/heartbeat_at|schema cache|column/i.test(saved.error.message || '')) {
      return { status: 200, body: { ok: true, skipped: true } }
    }
    throw saved.error
  }
  return { status: 200, body: { ok: true } }
}

export async function endDriverTrip(sb, user, trip, body, deps = {}) {
  const fail = (status, code, error) => ({ status, body: { ok: false, code, error } })
  if (!user?.id) return fail(401, 'auth_required', 'Sign in required')
  if (!trip) return fail(404, 'trip_not_found', 'Trip not found')
  const driverId = user.id
  if (trip.driver_id !== driverId && !endedBy(trip, driverId)) {
    return fail(403, 'forbidden', 'Not allowed on this trip')
  }
  if (!DRIVER_END_STATUSES.includes(trip.status)) {
    if (ALREADY_ENDED.has(trip.status) && (trip.driver_id === driverId || endedBy(trip, driverId))) {
      const hold = await (deps.releaseHold || releaseOpenFareHold)({
        sb, stripe: deps.stripe, trip, reason: 'driver_end',
      }).catch(() => ({ ok: false }))
      return { status: 200, body: { ok: true, idempotent: true, trip, charged: false, hold } }
    }
    return fail(409, 'invalid_transition', 'End trip is available while the ride is active.')
  }
  const invalid = validateDriverEnd(body?.reason, body?.note)
  if (invalid) return fail(400, 'invalid_reason', invalid)
  const at = deps.now || new Date().toISOString()
  const record = {
    driver_id: driverId,
    reason: body.reason,
    note: typeof body.note === 'string' ? body.note.trim() || null : null,
    at,
    from_status: trip.status,
  }
  const metadata = {
    ...metaOf(trip),
    cancel_reason: 'driver_end',
    driver_end: record,
  }
  const saved = await sb.from('trips').update({
    status: 'canceled',
    canceled_at: at,
    payment_status: 'no_charge',
    metadata,
  }).eq('id', trip.id).eq('driver_id', driverId).eq('status', trip.status).select('*').maybeSingle()
  if (saved?.error) throw saved.error
  if (!saved?.data) {
    const fresh = await sb.from('trips').select('*').eq('id', trip.id).maybeSingle()
    if (fresh?.error) throw fresh.error
    if (fresh?.data && ALREADY_ENDED.has(fresh.data.status) && (fresh.data.driver_id === driverId || endedBy(fresh.data, driverId))) {
      return { status: 200, body: { ok: true, idempotent: true, trip: fresh.data } }
    }
    return fail(409, 'transition_conflict', 'This ride changed. Refresh and try again.')
  }
  const releaseHold = deps.releaseHold || releaseOpenFareHold
  const hold = await releaseHold({
    sb,
    stripe: deps.stripe,
    trip: saved.data,
    reason: 'driver_end',
  })
  const event = await insertTripEvent(sb, {
    trip_id: trip.id,
    kind: 'driver_ended',
    payload: record,
  })
  if (saved.data.rider_id) {
    try {
      const notice = await sb.from('trip_status_notices').insert({
        trip_id: trip.id,
        kind: 'driver_ended',
        recipient_id: saved.data.rider_id,
        recipient_role: 'rider',
        driver_id: driverId,
        dedupe_key: `driver_ended:${trip.id}:${driverId}`,
      })
      if (notice?.error) console.error('[driver-end] notice', trip.id, notice.error.message)
    } catch (err) {
      console.error('[driver-end] notice', trip.id, err?.message || err)
    }
  }
  return {
    status: 200,
    body: {
      ok: true,
      trip: saved.data,
      charged: false,
      hold,
      ...(event?.error ? { eventWarning: event.error.message } : {}),
    },
  }
}
