import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTripStop } from './endpoints/tripStop.js'

const stops = [
  { lat: 1, lng: 1, label: 'Grand Marc', kind: 'pickup', participantId: 'pa', order: 0 },
  { lat: 2, lng: 2, label: 'The Pier', kind: 'pickup', participantId: 'pb', order: 1 },
  { lat: 4, lng: 4, label: 'College Ave', kind: 'dropoff', participantIds: ['pa', 'pb'], order: 2 },
]

function fakeSb(trip) {
  const state = { trip: structuredClone(trip), updates: [], events: [], filters: [] }
  const sb = {
    state,
    from(table) {
      const q = { table, op: 'select', patch: null, filters: [] }
      const chain = {
        select() { return chain },
        update(patch) { q.op = 'update'; q.patch = patch; return chain },
        insert(row) { state.events.push(row); return Promise.resolve({ data: null, error: null }) },
        eq(col, val) { q.filters.push(['eq', col, val]); return chain },
        is(col, val) { q.filters.push(['is', col, val]); return chain },
        in() { return chain },
        async maybeSingle() {
          if (q.op === 'update') {
            state.filters.push(q.filters)
            const rev = state.trip.metadata?.stop_rev ?? null
            const want = q.filters.find(([, c]) => c === 'metadata->stop_rev')
            if (want && (want[0] === 'is' ? rev !== null : rev !== want[2])) return { data: null, error: null }
            state.trip = { ...state.trip, ...q.patch }
            state.updates.push(q.patch)
          }
          return { data: structuredClone(state.trip), error: null }
        },
      }
      return chain
    },
  }
  return sb
}

const base = { id: 't1', driver_id: 'd1', rider_id: 'r1', status: 'accepted', stops, metadata: { kind: 'carpool', participants: [{ id: 'pa', display_name: 'Avery' }, { id: 'pb', display_name: 'Blake' }] } }

test('only the assigned driver may act, and single-rider trips are refused', async () => {
  const sb = fakeSb(base)
  assert.equal((await applyTripStop(sb, { tripId: 't1', stopIndex: 0, op: 'arrive', actorId: 'r1' })).http, 403)
  const solo = fakeSb({ ...base, stops: [], metadata: { kind: 'driver_request' } })
  const res = await applyTripStop(solo, { tripId: 't1', stopIndex: 0, op: 'arrive', actorId: 'd1' })
  assert.equal(res.http, 409)
  assert.equal(res.body.code, 'not_multi_stop')
})

test('first pickup arrive moves the trip to arrived through the wait clock', async () => {
  const sb = fakeSb(base)
  const calls = []
  const applyTripWait = async (_sb, args) => { calls.push(args.action); sb.state.trip.status = 'arrived'; return { trip: { ...sb.state.trip, status: 'arrived' } } }
  const res = await applyTripStop(sb, { tripId: 't1', stopIndex: 0, op: 'arrive', actorId: 'd1' }, { applyTripWait })
  assert.equal(res.http, 200)
  assert.deepEqual(calls, ['arrive'])
  assert.equal(sb.state.trip.stops[0].status, 'arrived')
  assert.equal(sb.state.trip.metadata.stop_flow, true)
  assert.equal(sb.state.trip.metadata.stop_rev, 1)
  assert.equal(sb.state.events[0].kind, 'stop_arrive')
  // Replay is idempotent and does not touch the wait clock again.
  const again = await applyTripStop(sb, { tripId: 't1', stopIndex: 0, op: 'arrive', actorId: 'd1' }, { applyTripWait })
  assert.equal(again.body.idempotent, true)
  assert.deepEqual(calls, ['arrive'])
})

test('out-of-order stops and later stops before Start are refused', async () => {
  const sb = fakeSb(base)
  const res = await applyTripStop(sb, { tripId: 't1', stopIndex: 2, op: 'drop', actorId: 'd1' })
  assert.equal(res.body.code, 'stop_out_of_order')
  assert.equal(res.body.nextIndex, 0)
})

test('a drop-off records each rider fare and the stop revision guards concurrent writes', async () => {
  const doneStops = stops.map((s, i) => (i < 2 ? { ...s, status: 'done' } : s))
  const sb = fakeSb({ ...base, status: 'in_progress', stops: doneStops, metadata: { ...base.metadata, stop_flow: true, stop_rev: 4 } })
  const captureFares = async (_sb, stop) => stop.participantIds.map((id) => ({ participantId: id, fareCents: 1000, capturedCents: 1000, status: 'captured' }))
  const res = await applyTripStop(sb, { tripId: 't1', stopIndex: 2, op: 'drop', actorId: 'd1' }, { captureFares })
  assert.equal(res.http, 200)
  assert.equal(sb.state.trip.stops[2].status, 'done')
  assert.equal(sb.state.trip.stops[2].fares.length, 2)
  assert.equal(sb.state.trip.metadata.carpool_captures.pb.capturedCents, 1000)
  assert.equal(sb.state.trip.metadata.stop_rev, 5)
  assert.deepEqual(sb.state.filters[0].find(([, c]) => c === 'metadata->stop_rev'), ['eq', 'metadata->stop_rev', 4])
})

test('a failed Start at the first pickup leaves the stop open', async () => {
  const sb = fakeSb({ ...base, status: 'arrived', stops: stops.map((s, i) => (i === 0 ? { ...s, status: 'arrived' } : s)) })
  const applyTripWait = async () => ({ trip: { ...sb.state.trip, status: 'cancelled_wait' } })
  const res = await applyTripStop(sb, { tripId: 't1', stopIndex: 0, op: 'start', actorId: 'd1' }, { applyTripWait })
  assert.equal(res.http, 409)
  assert.equal(res.body.code, 'trip_not_started')
  assert.equal(sb.state.updates.length, 0)
})
