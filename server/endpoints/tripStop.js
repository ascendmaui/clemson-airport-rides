/**
 * POST /api/driver?action=trip-stop
 * Body: { tripId, stopIndex, op: 'arrive' | 'start' | 'drop' }
 *
 * Carpool ordered stops. Only the assigned driver may act, stops resolve in
 * order, and a repeated op is idempotent. The first pickup drives the trip
 * status through trip_wait_apply (Arrived, Start trip). A drop-off records
 * each rider's fare for that stop. Completion still goes through settle,
 * which refuses while stops are open once this flow has started.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { applyTripWait } from '../tripWait.js'
import { insertTripEvent } from '../tripEvents.js'
import {
  applyStopOp,
  riderFareCapture,
  stopTripStatusError,
  storedStops,
  tripOpForStop,
  tripStops,
} from '../../shared/carpoolStops.js'

const MESSAGES = {
  not_multi_stop: 'This trip has a single pickup. Use the normal trip buttons.',
  stop_out_of_order: 'Finish the current stop first.',
  arrive_first: 'Tap Arrived at this pickup first.',
  start_first_pickup: 'Start the trip at the first pickup first.',
  trip_not_active: 'This trip is no longer active.',
  stop_not_found: 'That stop is not on this trip.',
  invalid_stop_op: 'That action does not fit this stop.',
  stop_conflict: 'This trip changed. Refresh and try again.',
}

async function captureFares(sb, stop) {
  const ids = stop.participantIds || []
  if (!ids.length) return []
  const parts = await sb.from('friend_ride_participants')
    .select('id, status, fare_cents, payment_id').in('id', ids)
  if (parts.error) throw parts.error
  const paymentIds = (parts.data || []).map((p) => p.payment_id).filter(Boolean)
  let payments = []
  if (paymentIds.length) {
    const pay = await sb.from('payments').select('id, status, amount_cents').in('id', paymentIds)
    if (pay.error) throw pay.error
    payments = pay.data || []
  }
  const byId = new Map((parts.data || []).map((p) => [String(p.id), p]))
  return ids.map((id) => {
    const participant = byId.get(String(id)) || { id, status: 'missing', fare_cents: 0 }
    const payment = payments.find((row) => row.id === participant.payment_id) || null
    return riderFareCapture(participant, payment)
  })
}

/** Trip statuses where a stop write may land. */
const STOP_WRITE_STATUSES = ['accepted', 'arriving', 'arrived', 'in_progress']

export async function applyTripStop(sb, { tripId, stopIndex, op, actorId }, deps = {}) {
  const fail = (http, code, extra = {}) => ({ http, body: { ok: false, code, error: MESSAGES[code] || code, ...extra } })
  const read = await sb.from('trips').select('*').eq('id', tripId).maybeSingle()
  if (read.error) throw read.error
  let trip = read.data
  if (!trip) return fail(404, 'trip_not_found')
  if (trip.driver_id !== actorId) return fail(403, 'forbidden')
  const stops = tripStops(trip)
  if (!stops.length) return fail(409, 'not_multi_stop')
  const index = Number(stopIndex)
  const target = stops[index]
  if (!target) return fail(400, 'stop_not_found')
  const applied = applyStopOp(stops, { index, op })
  if (applied.error) return fail(409, applied.error, applied.nextIndex != null ? { nextIndex: applied.nextIndex } : {})
  if (applied.idempotent) return { http: 200, body: { ok: true, idempotent: true, trip, stops } }
  const statusError = stopTripStatusError(target, trip.status)
  if (statusError) return fail(409, statusError)

  // First pickup: the trip itself arrives / starts (wait clock, rider pushes).
  const tripOp = tripOpForStop(target, op, trip.status)
  let wait = null
  if (tripOp) {
    wait = await (deps.applyTripWait || applyTripWait)(sb, { action: tripOp, tripId, actorId })
    trip = { ...trip, ...(wait?.trip || {}) }
    if (tripOp === 'start' && trip.status !== 'in_progress') {
      return { http: 409, body: { ok: false, code: 'trip_not_started', error: 'The trip could not start.', trip, wait } }
    }
  }

  let stop = applied.stop
  if (op === 'drop') {
    const fares = await (deps.captureFares || captureFares)(sb, stop)
    stop = { ...stop, fares }
    applied.stops[index] = stop
  }

  // Stop state lives only in trips.stops (each drop-off keeps its rider fares), so a
  // stop write never replaces metadata that other paths update. stops[0].rev guards
  // concurrent stop writes; the status filter refuses a write after a cancel.
  const raw = Array.isArray(trip.stops) ? trip.stops : []
  const rev = Number.isInteger(raw[0]?.rev) ? raw[0].rev : null
  const nextStops = storedStops(trip, applied.stops)
  nextStops[0] = { ...nextStops[0], rev: (rev ?? 0) + 1 }
  let write = sb.from('trips')
    .update({ stops: nextStops })
    .eq('id', tripId)
    .eq('driver_id', actorId)
    .in('status', STOP_WRITE_STATUSES)
  write = rev == null ? write.is('stops->0->>rev', null) : write.eq('stops->0->>rev', String(rev))
  const saved = await write.select('*').maybeSingle()
  if (saved.error) throw saved.error
  if (!saved.data) return fail(409, 'stop_conflict')

  const event = await insertTripEvent(sb, {
    trip_id: tripId,
    kind: `stop_${op}`,
    payload: {
      source: 'trip_stop',
      driver_id: actorId,
      stop_index: index,
      stop_kind: stop.kind,
      participant_ids: stop.participantIds,
      ...(op === 'drop' ? { fares: stop.fares } : {}),
      ...(tripOp ? { trip_op: tripOp } : {}),
    },
  })
  if (event.error) console.error('[trip-stop] event', event.error.message)
  return { http: 200, body: { ok: true, trip: saved.data, stops: tripStops(saved.data), stop, ...(wait ? { wait } : {}) } }
}

export default async function handleTripStop(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { ok: false, code: 'method_not_allowed', error: 'Method not allowed' })
  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return json(res, 503, { ok: false, code: 'service_unavailable', error: 'Service unavailable' })
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) return json(res, 401, { ok: false, code: 'auth_required', error: 'Sign in required' })
  const { body, error } = parseBody(req)
  if (error) return json(res, 400, { ok: false, code: 'invalid_body', error })
  const { tripId, stopIndex, op } = body || {}
  if (typeof tripId !== 'string' || !tripId.trim()) return json(res, 400, { ok: false, code: 'trip_id_required', error: 'tripId required' })
  try {
    const result = await applyTripStop(sb, { tripId, stopIndex, op, actorId: user.id }, deps)
    return json(res, result.http, result.body)
  } catch (err) {
    const status = err.status || (err.code === '22P02' ? 400 : 500)
    return json(res, status, { ok: false, code: status === 500 ? 'trip_stop_failed' : 'trip_stop_rejected', error: err.message || 'Stop update failed' })
  }
}
