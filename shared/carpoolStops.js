/**
 * Carpool ordered stops (driver flow slice 2).
 *
 * A pooled carpool / friend ride is booked as one trip whose `trips.stops`
 * jsonb holds the route in order: every pickup first, then every drop-off
 * (server/friendRideLib.js maybeBookFriendRide). Each stop carries the
 * participant(s) it serves. This module turns that list into the driver's
 * ordered stop list and applies per-stop actions:
 *
 *   pickup   arrive -> start (rider in the car)
 *   dropoff  arrive (optional) -> drop (records that rider's fare)
 *
 * Stops resolve strictly in order. Single-rider trips have no stop list and
 * keep the existing Arriving / Arrived / Start / Complete flow unchanged.
 * Pure functions only: the server endpoint and the native app share them.
 */

export const STOP_OPS = Object.freeze(['arrive', 'start', 'drop'])
export const STOP_TRIP_KINDS = Object.freeze(['carpool', 'friend_ride'])

function meta(trip) {
  const raw = trip?.metadata
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function participantsOf(trip) {
  const list = meta(trip).participants
  if (!Array.isArray(list)) return []
  return list
    .filter((row) => row && row.id != null)
    .map((row, index) => ({
      id: String(row.id),
      name: String(row.display_name || row.first_name || row.name || `Rider ${index + 1}`).trim().split(/\s+/)[0] || `Rider ${index + 1}`,
      fareCents: Math.max(0, Math.round(Number(row.fare_cents) || 0)),
    }))
}

function idsOf(stop) {
  const ids = []
  if (Array.isArray(stop?.participantIds)) ids.push(...stop.participantIds)
  if (stop?.participantId != null) ids.push(stop.participantId)
  return [...new Set(ids.filter((id) => id != null && id !== '').map(String))]
}

function kindOf(stop, index, count) {
  const raw = String(stop?.kind || '').toLowerCase()
  if (raw === 'pickup' || raw === 'dropoff') return raw
  // Older rows: origin is the first pickup, destination the last drop-off.
  return index === count - 1 ? 'dropoff' : 'pickup'
}

/**
 * Ordered driver stops, or [] for a trip that is not a multi-rider pool.
 * Participants that the booking de-duplicated away (same coordinates as an
 * earlier stop) ride with the first pickup and the last drop-off.
 */
export function tripStops(trip) {
  const kind = String(meta(trip).kind || '')
  const raw = Array.isArray(trip?.stops) ? trip.stops.filter((s) => s && typeof s === 'object') : []
  if (!STOP_TRIP_KINDS.includes(kind) || raw.length < 2) return []
  const ordered = raw
    .map((stop, index) => ({ stop, index }))
    .sort((a, b) => (num(a.stop.order) ?? a.index) - (num(b.stop.order) ?? b.index))
    .map(({ stop }) => stop)
  const people = participantsOf(trip)
  const byId = new Map(people.map((p) => [p.id, p]))
  const stops = ordered.map((stop, index) => {
    const stopKind = kindOf(stop, index, ordered.length)
    return {
      index,
      kind: stopKind,
      label: String(stop.label || (stopKind === 'pickup' ? 'Pickup' : 'Drop-off')),
      lat: num(stop.lat ?? stop.latitude),
      lng: num(stop.lng ?? stop.longitude),
      participantIds: idsOf(stop),
      status: ['arrived', 'done'].includes(stop.status) ? stop.status : 'pending',
      arrivedAt: typeof stop.arrived_at === 'string' ? stop.arrived_at : null,
      doneAt: typeof stop.done_at === 'string' ? stop.done_at : null,
      fares: Array.isArray(stop.fares) ? stop.fares : [],
    }
  })
  const firstPickup = stops.find((s) => s.kind === 'pickup')
  const lastDrop = [...stops].reverse().find((s) => s.kind === 'dropoff')
  for (const person of people) {
    if (firstPickup && !stops.some((s) => s.kind === 'pickup' && s.participantIds.includes(person.id))) {
      firstPickup.participantIds.push(person.id)
    }
    if (lastDrop && !stops.some((s) => s.kind === 'dropoff' && s.participantIds.includes(person.id))) {
      lastDrop.participantIds.push(person.id)
    }
  }
  for (const stop of stops) {
    stop.riders = stop.participantIds.map((id) => byId.get(id) || { id, name: 'Rider', fareCents: 0 })
  }
  // One pickup and one drop-off for a single rider is the normal flow.
  const riderCount = new Set(stops.flatMap((s) => s.participantIds)).size
  if (stops.length < 3 && riderCount < 2) return []
  return stops
}

export function isMultiStopTrip(trip) {
  return tripStops(trip).length > 0
}

/** Index of the first stop that is not done, or -1 when every stop is resolved. */
export function nextStopIndex(stops) {
  const list = Array.isArray(stops) ? stops : []
  return list.findIndex((stop) => stop.status !== 'done')
}

export function allStopsDone(stops) {
  const list = Array.isArray(stops) ? stops : []
  return list.length > 0 && list.every((stop) => stop.status === 'done')
}

/** The driver started the stop flow (any stop touched). Old builds never do. */
export function stopFlowStarted(trip) {
  return meta(trip).stop_flow === true || tripStops(trip).some((stop) => stop.status !== 'pending')
}

/** Allowed op for a stop in its current state, or null. */
export function stopNextOp(stop) {
  if (!stop || stop.status === 'done') return null
  if (stop.kind === 'pickup') return stop.status === 'arrived' ? 'start' : 'arrive'
  return 'drop'
}

/**
 * Apply one driver op. Returns { stops, stop, idempotent } or { error }.
 * Repeating an op that already happened is idempotent (offline retries).
 */
export function applyStopOp(stops, { index, op, at = new Date().toISOString() } = {}) {
  const list = Array.isArray(stops) ? stops.map((stop) => ({ ...stop })) : []
  if (!STOP_OPS.includes(op)) return { error: 'invalid_stop_op' }
  const i = Number(index)
  if (!Number.isInteger(i) || i < 0 || i >= list.length) return { error: 'stop_not_found' }
  const stop = list[i]
  const done = stop.status === 'done'
  if (op === 'arrive' && (stop.status === 'arrived' || done)) return { stops: list, stop, idempotent: true }
  if (op === 'start' && stop.kind === 'pickup' && done) return { stops: list, stop, idempotent: true }
  if (op === 'drop' && stop.kind === 'dropoff' && done) return { stops: list, stop, idempotent: true }
  const next = nextStopIndex(list)
  if (i !== next) return { error: 'stop_out_of_order', nextIndex: next }
  if (op === 'start' && stop.kind !== 'pickup') return { error: 'invalid_stop_op' }
  if (op === 'drop' && stop.kind !== 'dropoff') return { error: 'invalid_stop_op' }
  if (op === 'start' && stop.status !== 'arrived') return { error: 'arrive_first' }
  if (op === 'arrive') {
    list[i] = { ...stop, status: 'arrived', arrivedAt: at }
  } else {
    list[i] = { ...stop, status: 'done', arrivedAt: stop.arrivedAt || at, doneAt: at }
  }
  return { stops: list, stop: list[i], idempotent: false }
}

/** Back to the jsonb shape stored on trips.stops (keeps booking fields). */
export function storedStops(trip, stops) {
  const raw = Array.isArray(trip?.stops) ? trip.stops : []
  const ordered = raw
    .map((stop, index) => ({ stop, index }))
    .sort((a, b) => (num(a.stop?.order) ?? a.index) - (num(b.stop?.order) ?? b.index))
    .map(({ stop }) => stop)
  return stops.map((stop, index) => {
    const base = ordered[index] && typeof ordered[index] === 'object' ? ordered[index] : {}
    return {
      ...base,
      order: index,
      kind: stop.kind,
      participantIds: stop.participantIds,
      status: stop.status,
      arrived_at: stop.arrivedAt || null,
      done_at: stop.doneAt || null,
      ...(stop.fares?.length ? { fares: stop.fares } : {}),
    }
  })
}

function names(stop) {
  const list = (stop?.riders || []).map((r) => r.name).filter(Boolean)
  if (!list.length) return 'rider'
  if (list.length === 1) return list[0]
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

export function stopTitle(stop) {
  if (!stop) return ''
  return stop.kind === 'pickup' ? `Pick up ${names(stop)}` : `Drop off ${names(stop)}`
}

export function stopActionLabel(stop) {
  const op = stopNextOp(stop)
  if (op === 'arrive') return 'Arrived'
  if (op === 'start') return `${names(stop)} in car · Start`
  if (op === 'drop') return `Drop off ${names(stop)}`
  return null
}

export function stopStatusLabel(stop) {
  if (!stop) return ''
  if (stop.status === 'done') return stop.kind === 'pickup' ? 'In car' : 'Dropped off'
  if (stop.status === 'arrived') return 'Arrived'
  return 'Upcoming'
}

/**
 * Fare line per rider at a drop-off. Shares are charged when each rider
 * confirms the pool, so a drop records that share as collected for payout.
 */
export function riderFareCapture(participant, payment) {
  const fareCents = Math.max(0, Math.round(Number(participant?.fare_cents) || 0))
  const base = { participantId: String(participant?.id || ''), fareCents }
  if (fareCents === 0 && participant?.status === 'paid') return { ...base, status: 'comped', capturedCents: 0 }
  if (participant?.status !== 'paid') return { ...base, status: 'unpaid', capturedCents: 0 }
  if (payment && payment.status && payment.status !== 'succeeded') return { ...base, status: 'pending', capturedCents: 0 }
  return {
    ...base,
    status: 'captured',
    capturedCents: Math.max(0, Math.round(Number(payment?.amount_cents ?? fareCents) || 0)),
    paymentId: payment?.id || participant?.payment_id || null,
  }
}

export function fareCaptureLine(fare, name = 'Rider') {
  const dollars = `$${((Number(fare?.capturedCents ?? fare?.fareCents) || 0) / 100).toFixed(2)}`
  if (fare?.status === 'captured') return `${name} · ${dollars} collected`
  if (fare?.status === 'comped') return `${name} · first ride free`
  if (fare?.status === 'pending') return `${name} · payment pending`
  return `${name} · not collected`
}

/**
 * The first pickup drives the trip status (one wait clock for the pool):
 * arrive there is the trip's Arrived, start there is Start trip. Every later
 * stop happens while the trip is in progress.
 */
export function tripOpForStop(stop, op, tripStatus) {
  if (!stop || stop.index !== 0 || stop.kind !== 'pickup') return null
  if (op === 'arrive' && ['accepted', 'arriving'].includes(tripStatus)) return 'arrive'
  if (op === 'start' && tripStatus === 'arrived') return 'start'
  return null
}

export function stopTripStatusError(stop, tripStatus) {
  const status = String(tripStatus || '')
  if (!['accepted', 'arriving', 'arrived', 'in_progress'].includes(status)) return 'trip_not_active'
  if (stop && stop.index > 0 && status !== 'in_progress') return 'start_first_pickup'
  return null
}
