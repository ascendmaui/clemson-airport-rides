import assert from 'node:assert/strict'
import test from 'node:test'
import handler from './endpoints/rideOptions.js'
import { loadRideAvailability } from './rideAvailability.js'
import { seedMatchingScenario } from '../tests/fixtures/matchingE2E.js'

const NOW = new Date('2026-10-05T15:00:00Z')
const PICKUP = { lat: 34.6788, lng: -82.843 }

function fleet({ only = null, profileFailure = null } = {}) {
  const ids = only ? [only] : ['real', 'e2e', 'demo-marcus']
  const { supabase: sb, trip } = seedMatchingScenario({
    drivers: ids.map(id => ({ id, approved: true, online: true, ...PICKUP })),
    trip: { status: 'scheduled', pickup_at: '2026-10-05T20:00:00Z' },
  })
  for (const profile of sb._tables.profiles) {
    profile.email = profile.id === 'e2e' || profile.id === 'demo-marcus'
      ? `e2e+${profile.id}@clemsonrides.com` : `${profile.id}@example.com`
  }
  sb._tables.vehicles = ids.map(driver_id => ({ driver_id, service_class: driver_id === 'real' ? 'standard' : 'comfort' }))
  sb._tables.driver_status.forEach(row => { row.updated_at = NOW.toISOString() })
  if (profileFailure) {
    const from = sb.from
    sb.from = name => {
      if (name !== 'profiles') return from(name)
      if (profileFailure === 'throw') throw new Error('profile read failed')
      return { select() { return this }, in() { return this }, data: null, error: { message: 'profile read failed' } }
    }
  }
  return { sb, trip: sb._tables.trips[0] }
}

for (const scheduledFor of [null, '2026-10-05T20:00:00Z']) {
  test(`ride tiers isolate real and E2E riders (${scheduledFor ? 'scheduled' : 'now'})`, async () => {
    const { sb } = fleet()
    const real = await loadRideAvailability(sb, { now: NOW, scheduledFor })
    assert.deepEqual(real.availableTierIds, ['standard', 'wait', 'carpool'])
    const e2e = await loadRideAvailability(sb, { now: NOW, scheduledFor, riderIsE2E: true })
    assert.ok(e2e.availableTierIds.includes('comfort'))
    const realOnly = fleet({ only: 'real' }).sb
    assert.equal((await loadRideAvailability(realOnly, { now: NOW, scheduledFor, riderIsE2E: true })).empty, true)
    for (const only of ['e2e', 'demo-marcus']) {
      assert.equal((await loadRideAvailability(fleet({ only }).sb, { now: NOW, scheduledFor })).empty, true)
    }
    assert.equal((await loadRideAvailability(fleet({ only: 'demo-marcus' }).sb, { now: NOW, scheduledFor, riderIsE2E: true })).empty, true)
  })
}

for (const profileFailure of ['error', 'throw']) {
  test(`profile ${profileFailure} fails closed for test riders and open for real riders without failing the request`, async () => {
    for (const riderIsE2E of [false, true]) {
      const { sb, trip } = fleet({ profileFailure })
      const result = await loadRideAvailability(sb, { now: NOW, riderIsE2E })
      assert.equal(result.empty, riderIsE2E)
    assert.equal(result.error, null)
    }
  })
}

test('availability endpoint uses authenticated email or app metadata, ignoring body identity', async () => {
  for (const user of [null, { email: 'rider@example.com' }, { email: 'e2e+rider@clemsonrides.com' }, { app_metadata: { e2e_test: true } }]) {
    const e2e = Boolean(user?.app_metadata?.e2e_test || user?.email?.startsWith('e2e+'))
    const { sb } = fleet({ only: 'e2e' })
    const res = { setHeader() {}, end(body) { this.body = JSON.parse(body) } }
    await handler({ method: 'POST', headers: {}, body: { pickup: PICKUP, riderIsE2E: true } }, res, { sb, now: NOW, user })
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.availableTierIds.includes('comfort'), e2e)
  }
})
