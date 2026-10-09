import test from 'node:test'
import assert from 'node:assert/strict'
import handleTripStatus from './endpoints/tripStatus.js'
import driverRouter from '../api/driver.js'
import { commitRiderSwitch } from '../shared/riderSwitch.js'
import { offerVisibleToDriver } from '../shared/driverOrder.js'
import { DRIVER_CANCEL_REASONS } from '../shared/driverCancel.js'
import { rebroadcastMissedOffers } from './matchingRebroadcast.js'
import { sweepCanceledHolds } from './canceledHoldSweep.js'
import { fakeStripe } from '../tests/fixtures/cancelFareHolds.js'

const at = '2026-10-09T16:00:00.000Z'
const base = { id: 't1', rider_id: 'r1', driver_id: 'd1', status: 'accepted', tier: 'standard', fare_cents: 1851, deposit_cents: 0, accepted_at: at, metadata: {
  kind: 'driver_request', preserved: 'yes', offer_phase: 'pool', offer_passed_driver_ids: ['passed'],
  fare_authorization: { status: 'requires_capture', paymentIntentId: 'pi_hold', authorizationCents: 2221 },
} }
function fakeSb(trip = base, options = {}) {
  const tables = { trips: [structuredClone(trip)], trip_events: [], payments: [],
    location_shares: [{ trip_id: 't1', active: true }], trip_driver_locations: [{ trip_id: 't1', driver_id: 'd1' }], driver_offer_passes: [{ trip_id: 't1', driver_id: 'passed' }],
    // Empty driver pool for the expiry integration below.
    driver_status: [], driver_applications: [], profiles: [], vehicles: [], rider_preferences: [], rider_driver_favorites: [],
  }
  const mutations = []
  const sb = { tables, mutations, from(table) {
    tables[table] ||= []
    const filters = []; let mode = 'read', patch, count = Infinity
    const valueAt = (row, key) => key.includes('->') ? row.metadata?.fare_authorization?.status : row[key]
    const q = {
      select() { return q }, order() { return q }, limit(n) { count = n; return q },
      eq(k, v) { filters.push(['eq', k, v]); return q }, is(k, v) { filters.push(['is', k, v]); return q }, in(k, v) { filters.push(['in', k, v]); return q }, lte(k, v) { filters.push(['lte', k, v]); return q },
      or(expression) { filters.push(['or', 'canceled_at', expression.match(/^canceled_at\.lt\.(.*),canceled_at\.is\.null$/)[1]]); return q },
      update(v) { mode = 'update'; patch = v; return q }, insert(v) { mode = 'insert'; patch = v; return q }, delete() { mode = 'delete'; return q },
      async maybeSingle() { const result = run(); return { ...result, data: result.data?.[0] || null } },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject) },
    }
    function run() {
      if (mode !== 'read') mutations.push({ table, mode, patch, filters })
      if (mode === 'update' && table === 'trips') options.beforeUpdate?.(tables.trips[0])
      if (mode === 'insert') { tables[table].push(structuredClone(patch)); return { data: [patch], error: null } }
      const rows = tables[table].filter(row => filters.every(([type, key, expected]) => {
        const actual = valueAt(row, key)
        if (type === 'in') return expected.includes(actual)
        if (type === 'is') return expected === null ? actual == null : actual === expected
        if (type === 'lte') return actual != null && actual <= expected
        if (type === 'or') return actual == null || actual < expected
        return key === 'metadata' ? JSON.stringify(actual) === expected : actual === expected
      })).slice(0, count)
      if (mode === 'update') rows.forEach(row => Object.assign(row, structuredClone(patch)))
      if (mode === 'delete') tables[table] = tables[table].filter(row => !rows.includes(row))
      return { data: structuredClone(rows), error: null }
    }
    return q
  }, rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) }
  return sb
}
async function request(sb, body = {}, extra = {}) {
  const res = { setHeader() {}, end(value) { this.body = JSON.parse(value) } }
  await (extra.handler || handleTripStatus)({ method: 'POST', url: '/api/driver?action=trip-status', headers: {}, body: { tripId: 't1', op: 'driver-cancel', reason: 'vehicle_issue', ...body } }, res,
    { sb, user: { id: 'd1' }, now: at, listAssignableDrivers: async () => ({ drivers: [{ id: 'd1' }, { id: 'd2' }, { id: 'r1' }, { id: 'passed' }] }), notifyDriverOffer: async () => {}, ...extra })
  return res
}

test('endpoint authenticates the assigned driver, including replay actors', async () => {
  for (const id of ['r1', 'stranger']) {
    for (const metadata of [base.metadata, { ...base.metadata, driver_cancels: [{ driver_id: 'd1', at }] }]) {
      const sb = fakeSb({ ...base, metadata })
      assert.equal((await request(sb, {}, { user: { id } })).statusCode, 403)
      assert.equal(sb.mutations.length, 0)
    }
  }
  assert.equal((await request(fakeSb(), {}, { user: null })).statusCode, 401)
})

test('scheduled trips use backup queue; all other statuses are rejected', async () => {
  for (const key of ['scheduled_for', 'pickup_at']) {
    const sb = fakeSb({ ...base, [key]: at })
    const result = await request(sb)
    assert.equal(result.statusCode, 409)
    assert.equal(result.body.code, 'scheduled_use_backup')
    assert.equal(sb.mutations.length, 0)
  }
  for (const status of ['searching', 'offered', 'scheduled', 'arrived', 'in_progress', 'completed', 'canceled', 'canceled_midride', 'cancelled_wait']) {
    const sb = fakeSb({ ...base, status })
    assert.equal((await request(sb)).statusCode, 409, status)
    assert.equal(sb.mutations.length, 0)
  }
})

test('validates reasons and Other note before writes', async () => {
  for (const body of [{ reason: 'bogus' }, { reason: null }, { reason: 'other' }, { reason: 'other', note: '   ' }, { note: 123 }, { reason: 'other', note: 'a'.repeat(201) }, { note: 'a'.repeat(201) }]) {
    const sb = fakeSb()
    assert.equal((await request(sb, body)).statusCode, 400)
    assert.equal(sb.mutations.length, 0)
  }
  for (const reason of DRIVER_CANCEL_REASONS) {
    assert.equal((await request(fakeSb(), { reason: reason.id, ...(reason.id === 'other' ? { note: 'a'.repeat(200) } : {}) })).statusCode, 200)
  }
})

test('accepted/arriving reset the same trip into the pool, preserve fare/hold, audit and alert other drivers', async () => {
  for (const status of ['accepted', 'arriving']) {
    const trip = { ...base, status, metadata: { ...base.metadata, driver_cancels: [{ driver_id: 'old', at: '2026-10-08T16:00:00Z' }] } }
    const sb = fakeSb(trip), alerts = [], stripe = fakeStripe()
    const result = await request(sb, { note: ' Flat tire ' }, { stripeClient: () => { assert.fail('cancel must never call Stripe') }, stripe, notifyDriverOffer: async (_, input) => { alerts.push(input) } })
    assert.equal(result.statusCode, 200)
    const saved = sb.tables.trips[0]
    assert.equal(saved.status, 'searching')
    assert.equal(saved.id, trip.id)
    assert.equal(saved.driver_id, null)
    assert.equal(saved.accepted_at, null)
    assert.equal(saved.metadata.offer_driver_id, null)
    assert.equal(saved.metadata.preferred_driver_id, null)
    assert.deepEqual(saved.metadata.offer_passed_driver_ids, ['passed', 'd1'])
    assert.equal(saved.offer_expires_at, '2026-10-09T16:02:00.000Z')
    const rerequest = commitRiderSwitch({ trip, action: 'rerequest', drivers: [], now: at }).update
    for (const field of ['driver_earnings_cents', 'platform_fee_cents']) assert.equal(saved[field], rerequest[field])
    for (const field of ['offer_phase', 'offer_share_bps', 'pool_started_at', 'match']) assert.equal(saved.metadata[field], rerequest.metadata[field])
    assert.equal(saved.fare_cents, trip.fare_cents)
    assert.deepEqual(saved.metadata.fare_authorization, trip.metadata.fare_authorization)
    assert.equal(stripe.calls.length, 0)
    assert.equal(sb.tables.payments.length, 0)
    const record = { driver_id: 'd1', reason: 'vehicle_issue', note: 'Flat tire', at, from_status: status }
    assert.deepEqual(saved.metadata.driver_cancels, [...trip.metadata.driver_cancels, record])
    assert.deepEqual(sb.tables.trip_events, [{ trip_id: 't1', kind: 'driver_canceled', payload: record }])
    assert.equal(sb.tables.location_shares[0].active, false)
    assert.equal(sb.tables.trip_driver_locations.length, 0)
    assert.deepEqual(alerts.map(row => row.driverId), ['d2'])
    assert.equal(offerVisibleToDriver(saved, 'd1'), false)
    const writes = sb.mutations.filter(row => row.table === 'trips')
    assert.equal(writes.length, 1)
    assert.equal(Object.hasOwn(writes[0].patch, 'fare_cents'), false)
    assert.ok(writes[0].filters.some(row => row[1] === 'driver_id' && row[2] === 'd1'))
    assert.ok(writes[0].filters.some(row => row[0] === 'in' && row[1] === 'status'))
  }
})

test('replay succeeds for the recorded driver without redispatch, extra events or revoking a replacement share', async () => {
  const sb = fakeSb()
  assert.equal((await request(sb, {}, { handler: driverRouter })).statusCode, 200)
  const writesBeforeReplay = sb.mutations.length
  assert.deepEqual((await request(sb)).body, { ok: true, idempotent: true })
  assert.equal(sb.mutations.length, writesBeforeReplay)
  const saved = structuredClone(sb.tables.trips[0])
  sb.tables.trips[0].driver_id = 'd2'
  sb.tables.trips[0].status = 'accepted'
  sb.tables.location_shares[0].active = true
  assert.deepEqual((await request(sb)).body, { ok: true, idempotent: true })
  assert.equal(sb.tables.location_shares[0].active, true)
  assert.equal(sb.tables.trip_events.length, 1)
  assert.equal(sb.tables.trips[0].fare_cents, saved.fare_cents)
  assert.equal(sb.mutations.filter(row => row.table === 'trips').length, 1)
  assert.equal((await request(sb, {}, { user: { id: 'stranger' } })).statusCode, 403)
})

test('concurrent arrival or reassignment wins, and concurrent metadata is never overwritten', async () => {
  for (const patch of [{ status: 'arrived' }, { driver_id: 'd2' }, { metadata: { ...base.metadata, preserved: 'changed' } }]) {
    const sb = fakeSb(base, { beforeUpdate(row) { Object.assign(row, patch) } })
    assert.equal((await request(sb)).statusCode, 409)
    assert.equal(sb.tables.trip_events.length, 0)
    assert.equal(sb.tables.location_shares[0].active, true)
    assert.equal(sb.tables.trips[0].fare_cents, base.fare_cents)
  }
})

test('old cancel still rejects pre-pickup statuses with a driver-cancel hint', async () => {
  for (const status of ['accepted', 'arriving']) {
    const sb = fakeSb({ ...base, status })
    const result = await request(sb, { op: 'cancel' })
    assert.equal(result.statusCode, 409)
    assert.match(result.body.hint, /driver-cancel/)
    assert.equal(sb.mutations.length, 0)
  }
})

test('redispatch expiry cancels the trip and canceled-hold sweep releases, never captures, the retained hold', async () => {
  const sb = fakeSb(), stripe = fakeStripe()
  await request(sb)
  // While searching even an old hold remains in place.
  assert.equal((await sweepCanceledHolds(sb, { now: new Date(at), stripe })).released, 0)
  const expiredAt = new Date('2026-10-09T16:02:01Z')
  const expired = await rebroadcastMissedOffers(sb, { now: expiredAt })
  assert.equal(expired.expired, 1)
  assert.equal(sb.tables.trips[0].status, 'canceled')
  assert.equal(sb.tables.trips[0].metadata.fare_authorization.status, 'requires_capture')
  assert.equal((await sweepCanceledHolds(sb, { now: new Date('2026-10-09T16:05:00Z'), stripe })).released, 1)
  assert.equal(sb.tables.trips[0].metadata.fare_authorization.status, 'canceled')
  assert.deepEqual(stripe.calls.map(row => row.op), ['cancel'])
  assert.equal(sb.tables.payments.length, 0)
})
