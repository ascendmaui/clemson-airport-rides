import test from 'node:test'
import assert from 'node:assert/strict'
import { staleTripSkip, sweepStaleTrips, STALE_TRIP_MS, STALE_CANCEL_REASON } from './staleTripSweep.js'
import { SWEEPS } from './endpoints/tripSweeps.js'
import tickHandler from './endpoints/scheduledDispatchTick.js'
import { fakeStripe, seedHold } from '../tests/fixtures/cancelFareHolds.js'

const now = new Date('2026-10-13T18:00:00.000Z')
const ago = (min) => new Date(now.getTime() - min * 60000).toISOString()
const trip = (id, extra = {}) => ({
  id,
  rider_id: `r_${id}`,
  driver_id: `d_${id}`,
  status: 'in_progress',
  accepted_at: ago(40),
  created_at: ago(50),
  payment_status: 'requires_capture',
  metadata: { fare_authorization: { status: 'requires_capture', paymentIntentId: `pi_${id}` } },
  rider_heartbeat_at: null,
  driver_heartbeat_at: null,
  ...extra,
})

function fakeDb(rows, { locations = [], presence = [], failHeartbeatColumns = false } = {}) {
  const tables = {
    trips: structuredClone(rows),
    trip_driver_locations: structuredClone(locations),
    driver_status: structuredClone(presence),
    trip_status_notices: [],
  }
  function from(table) {
    const filters = []
    let patch = null
    let mode = 'select'
    const apply = () => tables[table].filter((row) => filters.every((fn) => fn(row)))
    const q = {
      select(columns) {
        if (failHeartbeatColumns && table === 'trips' && String(columns).includes('rider_heartbeat_at')) {
          q.error = { message: 'column rider_heartbeat_at does not exist' }
        }
        return q
      },
      update(next) { mode = 'update'; patch = next; return q },
      insert(row) {
        tables[table].push(row)
        return Promise.resolve({ error: null })
      },
      eq(column, value) { filters.push((row) => row[column] === value); return q },
      in(column, value) { filters.push((row) => value.includes(row[column])); return q },
      limit() { return q },
      maybeSingle() {
        if (q.error && mode === 'select') return Promise.resolve({ data: null, error: q.error })
        const hit = apply()[0] || null
        if (hit && mode === 'update' && patch) Object.assign(hit, structuredClone(patch))
        return Promise.resolve({ data: hit ? structuredClone(hit) : null, error: null })
      },
      then(resolve, reject) {
        if (q.error && mode === 'select') return Promise.resolve({ data: null, error: q.error }).then(resolve, reject)
        const hits = apply()
        if (mode === 'update' && patch) hits.forEach((row) => Object.assign(row, structuredClone(patch)))
        return Promise.resolve({ data: structuredClone(hits), error: null }).then(resolve, reject)
      },
    }
    return q
  }
  return { tables, from }
}

test('stale-trips is on the trip sweep list and the dispatch tick', () => {
  assert.equal(SWEEPS.some((sweep) => sweep.name === 'stale-trips'), true)
})

test('selection treats a lost driver heartbeat as abandoned even if the rider is still reporting', () => {
  const live = trip('live')
  assert.equal(staleTripSkip(live, { driverLocationAt: ago(1) }, now), 'signal_fresh')
  assert.equal(staleTripSkip(live, { driverHeartbeatAt: ago(2), riderHeartbeatAt: ago(30) }, now), 'signal_fresh')
  assert.equal(staleTripSkip(live, { riderLocationAt: ago(1), riderHeartbeatAt: ago(1) }, now), null)
  assert.equal(staleTripSkip(live, { driverHeartbeatAt: ago(20), riderHeartbeatAt: ago(1) }, now), null)
  assert.equal(staleTripSkip(live, { driverPresenceAt: ago(1) }, now), 'signal_fresh')
  assert.equal(staleTripSkip(live, {
    riderHeartbeatAt: ago(1),
    driverLocationAt: ago(16),
    driverHeartbeatAt: ago(16),
  }, now), null)
  assert.equal(staleTripSkip(live, {}, now), null)
  assert.equal(staleTripSkip({ ...live, accepted_at: ago(5) }, {}, now), 'too_new')
  assert.equal(staleTripSkip({ ...live, status: 'searching' }, {}, now), 'not_active')
  assert.equal(staleTripSkip({ ...live, status: 'completed' }, {}, now), 'not_active')
  assert.equal(staleTripSkip({ ...live, metadata: { e2e_test: true } }, {}, now), 'e2e_test')
  assert.equal(STALE_TRIP_MS, 15 * 60 * 1000)
})

test('a lost driver heartbeat cancels an in-progress ride the rider is still reporting', async () => {
  const { sb, trip: row } = seedHold('requires_capture')
  row.status = 'in_progress'
  row.accepted_at = ago(40)
  row.rider_heartbeat_at = ago(1)
  row.driver_heartbeat_at = ago(20)
  const stripe = fakeStripe()
  stripe.paymentIntents.capture = async () => { throw new Error('must not capture') }
  const result = await sweepStaleTrips(sb, { now, stripe })
  assert.equal(row.status, 'canceled')
  assert.equal(row.payment_status, 'no_charge')
  assert.equal(row.metadata.expired, true)
  assert.equal(row.metadata.fare_authorization.status, 'canceled')
  assert.equal(stripe.calls.some((call) => call.op === 'capture'), false)
  assert.equal(stripe.calls.some((call) => call.op === 'cancel'), true)
  assert.deepEqual(result.ids.canceled, ['trip-1'])
  assert.deepEqual(result.ids.released, ['trip-1'])
})

test('a rider crash does not select an in-progress ride the driver is still reporting', async () => {
  const sb = fakeDb([
    trip('crash', { rider_heartbeat_at: ago(30) }),
    trip('quiet'),
    trip('young', { accepted_at: ago(4) }),
    trip('searching', { status: 'searching', driver_id: null }),
  ], {
    locations: [{ trip_id: 'crash', updated_at: ago(1) }],
  })
  const released = []
  const result = await sweepStaleTrips(sb, {
    now,
    releaseHold: async ({ trip: row, reason }) => {
      released.push([row.id, reason])
      return { ok: true, released: true }
    },
  })
  assert.equal(sb.tables.trips.find((row) => row.id === 'crash').status, 'in_progress')
  assert.equal(sb.tables.trips.find((row) => row.id === 'young').status, 'in_progress')
  assert.equal(sb.tables.trips.find((row) => row.id === 'searching').status, 'searching')
  const quiet = sb.tables.trips.find((row) => row.id === 'quiet')
  assert.equal(quiet.status, 'canceled')
  assert.equal(quiet.payment_status, 'no_charge')
  assert.equal(quiet.metadata.cancel_reason, STALE_CANCEL_REASON)
  assert.equal(quiet.metadata.expired, true)
  assert.equal(quiet.metadata.stale_abandoned, true)
  assert.deepEqual(released, [['quiet', STALE_CANCEL_REASON]])
  assert.deepEqual(result.ids.canceled, ['quiet'])
  assert.deepEqual(result.ids.released, ['quiet'])
  assert.equal(sb.tables.trip_status_notices[0].kind, STALE_CANCEL_REASON)
  const again = await sweepStaleTrips(sb, {
    now,
    releaseHold: async () => { throw new Error('must not release twice') },
  })
  assert.equal(again.canceled, 0)
})

test('sweep releases the pre-auth hold and never captures', async () => {
  const { sb, trip: row } = seedHold('requires_capture')
  row.status = 'in_progress'
  row.accepted_at = ago(40)
  row.rider_heartbeat_at = ago(40)
  row.driver_heartbeat_at = ago(40)
  const stripe = fakeStripe()
  stripe.paymentIntents.capture = async () => {
    throw new Error('must not capture')
  }
  const result = await sweepStaleTrips(sb, { now, stripe })
  assert.equal(row.status, 'canceled')
  assert.equal(row.payment_status, 'no_charge')
  assert.equal(row.metadata.fare_authorization.status, 'canceled')
  assert.equal(stripe.calls.some((call) => call.op === 'capture'), false)
  assert.equal(stripe.calls.some((call) => call.op === 'cancel'), true)
  assert.deepEqual(result.ids.canceled, ['trip-1'])
  assert.deepEqual(result.ids.released, ['trip-1'])
})

test('dry run and a missing heartbeat column do not cancel a live driver signal', async () => {
  const sb = fakeDb([trip('dry')], { failHeartbeatColumns: true, locations: [{ trip_id: 'dry', updated_at: ago(1) }] })
  const result = await sweepStaleTrips(sb, { now, dryRun: true, releaseHold: async () => ({ released: true }) })
  assert.equal(sb.tables.trips[0].status, 'in_progress')
  assert.equal(result.canceled, 0)
  assert.deepEqual(result.ids.skipped, ['dry'])
})

test('scheduled dispatch tick runs the stale sweep', async () => {
  const { sb, trip: row } = seedHold('requires_capture')
  row.status = 'accepted'
  row.accepted_at = ago(40)
  row.pickup_at = null
  const stripe = fakeStripe()
  stripe.paymentIntents.capture = async () => { throw new Error('must not capture') }
  const res = { statusCode: 200, setHeader() {}, end(payload) { this.body = payload } }
  await tickHandler({
    method: 'POST',
    url: '/api/scheduled-dispatch-tick',
    headers: { authorization: 'Bearer test-cron' },
  }, res, { sb, env: { CRON_SECRET: 'test-cron' }, now, stripe })
  const body = JSON.parse(res.body)
  assert.equal(res.statusCode, 200)
  assert.equal(body.staleTrips.canceled, 1)
  assert.equal(row.status, 'canceled')
  assert.equal(row.payment_status, 'no_charge')
  assert.equal(stripe.calls.some((call) => call.op === 'capture'), false)
})
