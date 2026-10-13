import test from 'node:test'
import assert from 'node:assert/strict'
import { isE2ETestEmail, isE2ETestUser } from '../shared/e2eTestAccounts.js'
import { listAssignableDrivers } from './autoAssign.js'
import requestDriverTrip from './endpoints/requestDriverTrip.js'
import { rebroadcastMissedOffers } from './matchingRebroadcast.js'
import { runDuePayouts } from './endpoints/driverPayouts.js'
import { seedMatchingScenario } from '../tests/fixtures/matchingE2E.js'

function seed() {
  const { supabase } = seedMatchingScenario()
  supabase._tables.profiles[0].email = 'rider@example.com'
  supabase._tables.profiles[1].email = 'driver@example.com'
  supabase._tables.profiles[2].email = 'e2e+driver@clemsonrides.com'
  return supabase
}

test('reserved email pattern and trusted app metadata identify test accounts', () => {
  for (const email of ['e2e+rider@clemsonrides.com', 'E2E+Driver._-12@ClemsonRides.com']) {
    assert.equal(isE2ETestEmail(email), true)
    assert.equal(isE2ETestUser({ email }), true)
  }
  for (const email of [null, undefined, {}, '', 'e2e+@clemsonrides.com', 'e2e+x@example.com',
    ' e2e+x@clemsonrides.com', 'e2e+x@clemsonrides.com.evil', 'e2e+x@y@clemsonrides.com']) {
    assert.equal(isE2ETestEmail(email), false)
  }
  assert.equal(isE2ETestUser({ app_metadata: { e2e_test: true } }), true)
  assert.equal(isE2ETestUser({ app_metadata: { e2e_test: 'true' } }), false)
  assert.equal(isE2ETestUser({ user_metadata: { e2e_test: true } }), false)
  assert.equal(isE2ETestUser(null), false)
})

test('automatic matching partitions drivers using supplied or stored rider email', async () => {
  const sb = seed()
  assert.deepEqual((await listAssignableDrivers(sb, { riderId: 'rider-1' })).drivers.map(d => d.id), ['driver-1'])
  sb._tables.profiles[0].email = 'e2e+rider@clemsonrides.com'
  assert.deepEqual((await listAssignableDrivers(sb, { riderId: 'rider-1' })).drivers.map(d => d.id), ['driver-2'])
  assert.deepEqual((await listAssignableDrivers(sb, { riderEmail: 'rider@example.com' })).drivers.map(d => d.id), ['driver-1'])
  assert.deepEqual((await listAssignableDrivers(sb, { riderIsE2E: true })).drivers.map(d => d.id), ['driver-2'])
  sb._tables.driver_status[1].online = false
  assert.deepEqual((await listAssignableDrivers(sb, { riderEmail: 'e2e+rider@clemsonrides.com' })).drivers, [])
})

test('rider identity lookup errors fail closed', async () => {
  const sb = seed()
  const from = sb.from
  sb.from = table => {
    const q = from(table)
    const select = q.select
    q.select = columns => {
      if (table === 'profiles' && columns === 'email') {
        q.maybeSingle = async () => ({ error: { message: 'identity lookup failed' } })
      }
      return select(columns)
    }
    return q
  }
  const result = await listAssignableDrivers(sb, { riderId: 'rider-1' })
  assert.equal(result.error, 'identity lookup failed')
  assert.deepEqual(result.drivers, [])
})

test('missing comfort columns still isolate by email', async () => {
  const sb = seed()
  const from = sb.from
  sb.from = table => {
    const q = from(table)
    const select = q.select
    q.select = columns => {
      if (table === 'profiles' && columns.includes('gender_identity')) {
        const failure = Promise.resolve({ error: { message: 'column gender_identity does not exist' } })
        return { in: () => failure }
      }
      return select(columns)
    }
    return q
  }
  assert.deepEqual((await listAssignableDrivers(sb, { riderId: 'rider-1' })).drivers.map(d => d.id), ['driver-1'])
  assert.deepEqual((await listAssignableDrivers(sb, { riderId: 'rider-1', riderEmail: 'e2e+rider@clemsonrides.com' })).drivers.map(d => d.id), ['driver-2'])
})

async function book(sb, email, driverId, extraUser = {}) {
  const res = { setHeader() {}, end(body) { this.body = JSON.parse(body) } }
  await requestDriverTrip({ method: 'POST', headers: {}, body: {
    tier: 'standard', driverId, pickupLabel: 'Cooper Library', pickupLat: 34.6766, pickupLng: -82.8364,
    dest: 'Clemson Downtown', destLat: 34.6834, destLng: -82.8374, note: 'E2E TEST - automated harness',
  } }, res, { sb, user: { id: 'rider-1', email, ...extraUser }, stripe: null, ensureProfile: async () => ({ ok: true }) })
  return res
}

test('explicit picks reject both directions of mixed test and real accounts before inserting', async () => {
  for (const [email, driverId] of [['rider@example.com', 'driver-2'], ['e2e+rider@clemsonrides.com', 'driver-1']]) {
    const sb = seed()
    const res = await book(sb, email, driverId)
    assert.equal(res.statusCode, 409)
    assert.equal(res.body.code, 'ride_option_unavailable')
    assert.equal(sb._tables.trips.length, 1)
  }
})

test('same-partition picks preserve booking and only test rides get the metadata flag', async () => {
  for (const [email, driverId, e2e] of [['rider@example.com', 'driver-1', false], ['e2e+rider@clemsonrides.com', 'driver-2', true]]) {
    const sb = seed()
    const res = await book(sb, email, driverId)
    assert.equal(res.statusCode, 200, JSON.stringify(res.body))
    const row = sb._tables.trips.at(-1)
    assert.equal(row.metadata.e2e_test, e2e ? true : undefined)
    assert.equal(row.metadata.offer_driver_id, driverId)
    assert.equal(row.status, 'searching')
    assert.equal(row.rider_note, 'E2E TEST - automated harness')
  }
})

test('trusted rider app metadata also marks bookings and rejects a real driver', async () => {
  const sb = seed()
  const extra = { app_metadata: { e2e_test: true } }
  assert.equal((await book(sb, 'rider@example.com', 'driver-1', extra)).statusCode, 409)
  assert.equal((await book(sb, 'rider@example.com', 'driver-2', extra)).statusCode, 200)
  assert.equal(sb._tables.trips.at(-1).metadata.e2e_test, true)
})

test('rebroadcast skips test trips and alerts only real drivers for normal trips', async () => {
  const sb = seed()
  const trip = sb._tables.trips[0]
  trip.offer_expires_at = '2026-10-04T12:00:00.000Z'
  trip.metadata = { kind: 'driver_request', offer_driver_id: 'driver-1', e2e_test: true }
  const before = structuredClone(sb._tables)
  const alerted = []
  const options = { now: new Date('2026-10-04T12:01:00.000Z'), alertDriver: async (_, offer) => alerted.push(offer.driverId) }
  assert.equal((await rebroadcastMissedOffers(sb, options)).skipped, 1)
  assert.deepEqual(sb._tables, before)
  assert.deepEqual(alerted, [])
  delete trip.metadata.e2e_test
  assert.equal((await rebroadcastMissedOffers(sb, options)).pooled, 1)
  assert.deepEqual(alerted, ['driver-1'])
})

test('daily payouts skip test trips before primary, standby and switch transfers or writes', async () => {
  const calls = []
  const trips = [true, false].map((e2e, i) => ({ id: `trip-${i}`, driver_id: 'driver-1', metadata: {
    e2e_test: e2e, payout: { status: 'pending', amountCents: 800 },
  } }))
  const result = await runDuePayouts({}, trips, 'acct_test', {
    stripe: {}, now: Date.now(),
    attemptDriverPayout: async ({ trip }) => { calls.push(trip.id); return { ok: true, payout: { status: 'paid' } } },
    writePayout: async (_, trip) => calls.push(`write:${trip.id}`),
    attemptStandbyBackupPayout: async ({ trip }) => { calls.push(`standby:${trip.id}`) },
    attemptSwitchFeePayout: async ({ trip }) => { calls.push(`switch:${trip.id}`) },
  })
  assert.deepEqual(calls, ['trip-1', 'write:trip-1', 'standby:trip-1', 'switch:trip-1'])
  assert.equal(result.length, 1)
  assert.equal(result[0].tripId, 'trip-1')
})
