import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allStopsDone, applyStopOp, fareCaptureLine, isMultiStopTrip, nextStopIndex, riderFareCapture,
  stopActionLabel, stopFlowStarted, stopTripStatusError, storedStops, tripOpForStop, tripStops,
} from './carpoolStops.js'

const pool = (stops, extra = {}) => ({
  id: 't1',
  status: 'accepted',
  stops,
  metadata: {
    kind: 'carpool',
    participants: [
      { id: 'pa', display_name: 'Avery Lee', fare_cents: 1200 },
      { id: 'pb', display_name: 'Blake', fare_cents: 1100 },
    ],
    ...extra,
  },
})

const booked = [
  { lat: 1, lng: 1, label: 'Grand Marc', kind: 'pickup', participantId: 'pa', order: 0 },
  { lat: 2, lng: 2, label: 'The Pier', kind: 'pickup', participantId: 'pb', order: 1 },
  { lat: 3, lng: 3, label: 'Tiger Town', kind: 'dropoff', participantId: 'pb', order: 2 },
  { lat: 4, lng: 4, label: 'College Ave', kind: 'dropoff', participantId: 'pa', order: 3 },
]

test('single-rider trips have no stop list', () => {
  assert.deepEqual(tripStops({ stops: [], metadata: { kind: 'driver_request' } }), [])
  assert.deepEqual(tripStops({ stops: booked, metadata: { kind: 'driver_request' } }), [])
  assert.equal(isMultiStopTrip({ stops: null, metadata: {} }), false)
  // A one-rider friend ride (pickup + drop-off) keeps the normal flow.
  const solo = { stops: booked.slice(0, 1).concat(booked[3]), metadata: { kind: 'friend_ride', participants: [{ id: 'pa' }] } }
  assert.equal(isMultiStopTrip(solo), false)
})

test('a carpool lists pickups then drop-offs with rider names', () => {
  const stops = tripStops(pool(booked))
  assert.deepEqual(stops.map((s) => `${s.kind}:${s.label}`), [
    'pickup:Grand Marc', 'pickup:The Pier', 'dropoff:Tiger Town', 'dropoff:College Ave',
  ])
  assert.equal(stops[0].riders[0].name, 'Avery')
  assert.equal(stopActionLabel(stops[0]), 'Arrived')
  assert.equal(nextStopIndex(stops), 0)
})

test('riders collapsed into a shared stop ride with the first pickup and last drop-off', () => {
  const stops = tripStops(pool([
    { lat: 1, lng: 1, label: 'Grand Marc', kind: 'pickup', participantId: 'pa', order: 0 },
    { lat: 4, lng: 4, label: 'College Ave', kind: 'dropoff', participantId: 'pa', order: 1 },
  ]))
  assert.equal(stops.length, 2)
  assert.deepEqual(stops[0].participantIds, ['pa', 'pb'])
  assert.deepEqual(stops[1].participantIds, ['pa', 'pb'])
})

test('stops resolve strictly in order and retries are idempotent', () => {
  let stops = tripStops(pool(booked))
  assert.equal(applyStopOp(stops, { index: 1, op: 'arrive' }).error, 'stop_out_of_order')
  assert.equal(applyStopOp(stops, { index: 0, op: 'start' }).error, 'arrive_first')
  assert.equal(applyStopOp(stops, { index: 0, op: 'drop' }).error, 'invalid_stop_op')
  let r = applyStopOp(stops, { index: 0, op: 'arrive', at: 'T1' })
  stops = r.stops
  assert.equal(stops[0].status, 'arrived')
  assert.equal(applyStopOp(stops, { index: 0, op: 'arrive' }).idempotent, true)
  stops = applyStopOp(stops, { index: 0, op: 'start', at: 'T2' }).stops
  assert.equal(stops[0].status, 'done')
  assert.equal(applyStopOp(stops, { index: 0, op: 'start' }).idempotent, true)
  stops = applyStopOp(stops, { index: 1, op: 'arrive' }).stops
  stops = applyStopOp(stops, { index: 1, op: 'start' }).stops
  // Drop-offs do not need a separate arrive.
  stops = applyStopOp(stops, { index: 2, op: 'drop' }).stops
  assert.equal(allStopsDone(stops), false)
  stops = applyStopOp(stops, { index: 3, op: 'drop' }).stops
  assert.equal(allStopsDone(stops), true)
  assert.equal(nextStopIndex(stops), -1)
})

test('stored stops keep booking fields and round-trip', () => {
  const trip = pool(booked)
  const applied = applyStopOp(tripStops(trip), { index: 0, op: 'arrive', at: 'T1' })
  const stored = storedStops(trip, applied.stops)
  assert.equal(stored[0].label, 'Grand Marc')
  assert.equal(stored[0].participantId, 'pa')
  assert.equal(stored[0].status, 'arrived')
  assert.equal(stored[0].arrived_at, 'T1')
  const again = tripStops({ ...trip, stops: stored })
  assert.equal(again[0].status, 'arrived')
  assert.equal(stopFlowStarted({ ...trip, stops: stored }), true)
  assert.equal(stopFlowStarted(trip), false)
})

test('the first pickup drives trip Arrived and Start; later stops need the trip started', () => {
  const stops = tripStops(pool(booked))
  assert.equal(tripOpForStop(stops[0], 'arrive', 'accepted'), 'arrive')
  assert.equal(tripOpForStop(stops[0], 'arrive', 'arriving'), 'arrive')
  assert.equal(tripOpForStop(stops[0], 'start', 'arrived'), 'start')
  assert.equal(tripOpForStop(stops[1], 'arrive', 'in_progress'), null)
  assert.equal(stopTripStatusError(stops[1], 'arrived'), 'start_first_pickup')
  assert.equal(stopTripStatusError(stops[1], 'in_progress'), null)
  assert.equal(stopTripStatusError(stops[0], 'completed'), 'trip_not_active')
})

test('per-rider fare capture at drop-off', () => {
  assert.deepEqual(
    riderFareCapture({ id: 'pa', status: 'paid', fare_cents: 1200, payment_id: 'p1' }, { id: 'p1', status: 'succeeded', amount_cents: 1200 }),
    { participantId: 'pa', fareCents: 1200, status: 'captured', capturedCents: 1200, paymentId: 'p1' },
  )
  assert.equal(riderFareCapture({ id: 'pa', status: 'paid', fare_cents: 0 }).status, 'comped')
  assert.equal(riderFareCapture({ id: 'pa', status: 'invited', fare_cents: 900 }).status, 'unpaid')
  assert.equal(riderFareCapture({ id: 'pa', status: 'paid', fare_cents: 900 }, { status: 'pending' }).status, 'pending')
  assert.equal(fareCaptureLine({ status: 'captured', capturedCents: 1200 }, 'Avery'), 'Avery · $12.00 collected')
})

test('a drop-off at another rider pickup point stays its own stop', async () => {
  const { buildWaypointList } = await import('../server/friendRideCore.js')
  const parts = [
    { id: 'A', pickup: { lat: 1, lng: 1 }, dropoff: { lat: 2, lng: 2 } },
    { id: 'B', pickup: { lat: 2, lng: 2 }, dropoff: { lat: 3, lng: 3 } },
  ]
  const w = buildWaypointList(parts)
  const stops = tripStops({ stops: [w.origin, ...w.intermediates, w.destination], metadata: { kind: 'carpool', participants: parts } })
  assert.deepEqual(stops.map((s) => [s.kind, s.participantIds]), [
    ['pickup', ['A']], ['pickup', ['B']], ['dropoff', ['A']], ['dropoff', ['B']],
  ])
})

test('the booking path builds the same stops as the core helper', async () => {
  const lib = await import('../server/friendRideLib.js')
  const core = await import('../server/friendRideCore.js')
  const parts = [
    { id: 'A', pickup: { lat: 1, lng: 1 }, dropoff: { lat: 2, lng: 2 } },
    { id: 'B', pickup: { lat: 2, lng: 2 }, dropoff: { lat: 3, lng: 3 } },
  ]
  const a = lib.buildWaypointList(parts)
  const b = core.buildWaypointList(parts)
  assert.deepEqual([a.origin, ...a.intermediates, a.destination], [b.origin, ...b.intermediates, b.destination])
  assert.equal(a.intermediates.length, 2)
})

test('riders sharing a pickup point share one stop', async () => {
  const { buildWaypointList } = await import('../server/friendRideCore.js')
  const parts = [
    { id: 'A', pickup: { lat: 1, lng: 1 }, dropoff: { lat: 5, lng: 5 } },
    { id: 'B', pickup: { lat: 1, lng: 1 }, dropoff: { lat: 3, lng: 3 } },
    { id: 'C', pickup: { lat: 2, lng: 2 }, dropoff: { lat: 5, lng: 5 } },
  ]
  const w = buildWaypointList(parts)
  assert.deepEqual(w.origin.participantIds, ['A', 'B'])
  assert.deepEqual(w.destination.participantIds.sort(), ['A', 'C'])
})
