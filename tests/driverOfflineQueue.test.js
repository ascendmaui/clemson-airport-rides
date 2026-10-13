import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { projectQueuedTrip } from '../packages/rides-native/queuedTrip.js'
import { advanceOpFor, sendQueuedDriverAction } from '../packages/rides-native/driverDesk.js'
import { tripStops } from '../shared/carpoolStops.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('queued status taps project the next step on the trip card', () => {
  const card = { id: 't1', status: 'arriving', stops: [] }
  assert.equal(projectQueuedTrip(card, []), card)
  const shown = projectQueuedTrip(card, [
    { id: 'k1', tripId: 't1', kind: 'status', op: 'arrive' },
    { id: 'k2', tripId: 't1', kind: 'status', op: 'start' },
    { id: 'k3', tripId: 'other', kind: 'status', op: 'complete' },
  ])
  assert.equal(shown.status, 'in_progress')
  assert.equal(shown.queuedTaps, 2)
  assert.equal(shown.waitingForSignal, 'Waiting for signal · 2 taps saved')
  assert.equal(advanceOpFor('accepted'), 'arriving')
  assert.equal(advanceOpFor('in_progress'), 'complete')
})

test('queued carpool stop taps advance the stop list and the first pickup moves the trip', () => {
  const trip = {
    id: 't1', status: 'arriving',
    stops: [
      { lat: 1, lng: 1, label: 'A', kind: 'pickup', participantId: 'pa' },
      { lat: 2, lng: 2, label: 'B', kind: 'pickup', participantId: 'pb' },
      { lat: 3, lng: 3, label: 'C', kind: 'dropoff', participantIds: ['pa', 'pb'] },
    ],
    metadata: { kind: 'carpool', participants: [{ id: 'pa', display_name: 'Avery' }, { id: 'pb', display_name: 'Blake' }] },
  }
  const card = { id: 't1', status: 'arriving', stops: tripStops(trip) }
  const shown = projectQueuedTrip(card, [
    { id: 'k1', tripId: 't1', kind: 'stop', stopIndex: 0, op: 'arrive', queuedAt: 'T1' },
    { id: 'k2', tripId: 't1', kind: 'stop', stopIndex: 0, op: 'start', queuedAt: 'T2' },
    { id: 'k3', tripId: 't1', kind: 'stop', stopIndex: 1, op: 'arrive', queuedAt: 'T3' },
  ])
  assert.equal(shown.status, 'in_progress')
  assert.deepEqual(shown.stops.map((s) => s.status), ['done', 'arrived', 'pending'])
  // An out-of-order tap is not projected.
  const bad = projectQueuedTrip(card, [{ id: 'k9', tripId: 't1', kind: 'stop', stopIndex: 2, op: 'drop' }])
  assert.deepEqual(bad.stops.map((s) => s.status), ['pending', 'pending', 'pending'])
})

test('queued sends carry the idempotency key and time out instead of hanging', async () => {
  const calls = []
  const fetchOk = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), signal: init.signal }); return { ok: true, status: 200, text: async () => '{"ok":true,"trip":{"id":"t1","status":"arrived"}}' } }
  const prior = globalThis.fetch
  globalThis.fetch = fetchOk
  try {
    await sendQueuedDriverAction(null, { id: 'drv-key-1', tripId: 't1', kind: 'status', op: 'arrive' })
    await sendQueuedDriverAction(null, { id: 'drv-key-2', tripId: 't1', kind: 'stop', stopIndex: 1, op: 'drop' })
    assert.match(calls[0].url, /action=trip-status$/)
    assert.deepEqual(calls[0].body, { tripId: 't1', op: 'arrive', idempotencyKey: 'drv-key-1' })
    assert.match(calls[1].url, /action=trip-stop$/)
    assert.deepEqual(calls[1].body, { tripId: 't1', stopIndex: 1, op: 'drop', idempotencyKey: 'drv-key-2' })
    assert.ok(calls[0].signal)

    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })))
    })
    await assert.rejects(
      () => sendQueuedDriverAction(null, { id: 'drv-key-3', tripId: 't1', kind: 'status', op: 'start' }, { timeoutMs: 20 }),
      (err) => err.name === 'AbortError',
    )
  } finally {
    globalThis.fetch = prior
  }
})

test('the trip screen sends taps through the queue and shows Waiting for signal', () => {
  const trip = read('apps/driver/app/trip.tsx')
  assert.match(trip, /queue\.submit\(\{ kind: 'status', tripId: trip\.id, op \}\)/)
  assert.match(trip, /queue\.submit\(\{ kind: 'stop', tripId: trip\.id, stopIndex: stop\.index, op \}\)/)
  assert.match(trip, /projectQueuedTrip\(serverTrip, queueState\.actions\)/)
  assert.match(trip, /\{signalLabel \? \(/)
  const lib = read('apps/driver/lib/actionQueue.ts')
  assert.match(lib, /storage: authStorage/)
  assert.match(lib, /next === 'active'\) void queue\?\.flush\(\)/)
  // Accept, no-show cancel, and driver cancel are never queued.
  assert.doesNotMatch(trip, /submit\(\{ kind: 'status', tripId: trip\.id, op: '(accept|cancel|driver-cancel)'/)
})

test('trip-status and trip-stop store idempotency receipts', () => {
  assert.match(read('server/endpoints/tripStatus.js'), /withActionReceipts\(req, res, deps, runTripStatus/)
  assert.match(read('server/endpoints/tripStop.js'), /withActionReceipts\(req, res, deps, runTripStop/)
  const sql = read('supabase/migrations/20261010130000_driver_action_receipts.sql')
  assert.match(sql, /enable row level security/)
  assert.match(sql, /revoke all on public\.driver_action_receipts from public, anon, authenticated/)
})

test('a canceled trip is never shown as in progress because of saved taps', () => {
  const shown = projectQueuedTrip({ id: 't1', status: 'canceled', stops: [] }, [{ id: 'k', tripId: 't1', kind: 'status', op: 'start' }])
  assert.equal(shown.status, 'canceled')
  const trip = read('apps/driver/app/trip.tsx')
  // A background send adopts the returned trip before the projection is removed.
  assert.match(trip, /event\.type === 'sent' \? event\.result\?\.trip : null/)
})
