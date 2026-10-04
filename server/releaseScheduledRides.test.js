import test from 'node:test'
import assert from 'node:assert/strict'
import { releaseScheduledRides } from './releaseScheduledRides.js'
import { rebroadcastMissedOffers } from './matchingRebroadcast.js'
import { seedMatchingScenario } from '../tests/fixtures/matchingE2E.js'
import { toRiderScheduleCard } from '../src/lib/scheduledRideModel.js'

const now = new Date('2026-10-09T23:15:00Z')
const pickup = '2026-10-10T00:00:00.000Z'
function seed(patch = {}) {
  return seedMatchingScenario({ trip: {
    status: 'scheduled', driver_id: null, pickup_at: pickup, scheduled_for: pickup,
    deposit_cents: 0, metadata: { kind: 'scheduled', purpose: 'party_weekend' }, ...patch,
  } }).supabase
}
const quiet = { now, alertDriver: async () => {} }

test('45-minute boundary releases once, preserves pickup, and uses existing rebroadcast', async () => {
  const sb = seed()
  assert.equal((await releaseScheduledRides(sb, { ...quiet, now: new Date(now - 1) })).released, 0)
  assert.equal((await releaseScheduledRides(sb, quiet)).released, 1)
  const trip = sb._tables.trips[0]
  assert.equal(trip.status, 'searching')
  assert.equal(trip.metadata.offer_driver_id, 'driver-1')
  assert.equal(trip.pickup_at, null)
  assert.equal(toRiderScheduleCard(trip).pickupAt, pickup)
  assert.equal(toRiderScheduleCard(trip).canCancel, true)
  assert.equal((await releaseScheduledRides(sb, quiet)).released, 0)
  // Production's existing deadline trigger supplies this timestamp.
  trip.offer_expires_at = now.toISOString()
  assert.equal((await rebroadcastMissedOffers(sb, quiet)).advanced, 1)
  assert.equal(sb._tables.trips[0].metadata.offer_driver_id, 'driver-2')
})

test('future, assigned, terminal and deposit rides never release', async () => {
  for (const patch of [
    { pickup_at: '2026-10-11T00:00:00Z' }, { driver_id: 'driver-1' },
    { status: 'accepted' }, { status: 'canceled' }, { status: 'completed' }, { deposit_cents: 500 },
  ]) assert.equal((await releaseScheduledRides(seed(patch), quiet)).released, 0)
})

test('concurrent sweeps have one winner and dry-run is read-only', async () => {
  const sb = seed()
  const before = structuredClone(sb._tables)
  assert.equal((await releaseScheduledRides(sb, { ...quiet, dryRun: true })).wouldRelease, 1)
  assert.deepEqual(sb._tables, before)
  const results = await Promise.all([releaseScheduledRides(sb, quiet), releaseScheduledRides(sb, quiet)])
  assert.equal(results.reduce((sum, r) => sum + r.released, 0), 1)
})

test('cancellation wins a release race', async () => {
  const sb = seed()
  const from = sb.from
  sb.from = table => {
    if (table === 'driver_status') sb._tables.trips[0].status = 'canceled'
    return from(table)
  }
  assert.equal((await releaseScheduledRides(sb, quiet)).released, 0)
  assert.equal(sb._tables.trips[0].status, 'canceled')
})

test('no online drivers uses open pool; stale reservations expire without offers', async () => {
  const sb = seed()
  sb._tables.driver_status.forEach(d => { d.online = false })
  await releaseScheduledRides(sb, quiet)
  assert.equal(sb._tables.trips[0].metadata.match, 'open')
  const stale = seed({ pickup_at: '2026-10-08T00:00:00Z' })
  let alerts = 0
  await releaseScheduledRides(stale, { now, alertDriver: async () => { alerts++ } })
  assert.equal(stale._tables.trips[0].status, 'canceled')
  assert.equal(alerts, 0)
})

test('release honors default driver order and handles legacy null metadata', async () => {
  const sb = seed({ metadata: null })
  sb._tables.profiles.find(p => p.id === 'driver-2').email = 'johnmatveyev@gmail.com'
  sb._tables.profiles.find(p => p.id === 'driver-1').email = 'kimubermaui@gmail.com'
  assert.equal((await releaseScheduledRides(sb, quiet)).released, 1)
  assert.equal(sb._tables.trips[0].metadata.offer_driver_id, 'driver-2')
})
