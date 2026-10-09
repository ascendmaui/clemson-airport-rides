import assert from 'node:assert/strict'
import test from 'node:test'
import handler from './endpoints/scheduleSlots.js'
import { loadNearTermOffer } from './nearTermAvailability.js'
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

test('wait counts only drivers in the rider group and excludes demos', async () => {
  const { sb } = fleet()
  for (const riderIsE2E of [false, true]) {
    const offer = await loadNearTermOffer(sb, { pickup: PICKUP, now: NOW, riderIsE2E })
    assert.equal(offer.availableDrivers, 1)
    const comfort = await loadNearTermOffer(sb, { pickup: PICKUP, now: NOW, tier: 'comfort', riderIsE2E })
    assert.equal(comfort.availableDrivers, riderIsE2E ? 1 : 0)
  }
  for (const [only, riderIsE2E] of [['e2e', false], ['real', true], ['demo-marcus', false], ['demo-marcus', true]]) {
    assert.equal((await loadNearTermOffer(fleet({ only }).sb, { pickup: PICKUP, now: NOW, riderIsE2E })).availableDrivers, 0)
  }
})

for (const profileFailure of ['error', 'throw']) {
  test(`profile ${profileFailure} fails closed for test riders and open for real riders without failing the request`, async () => {
    for (const riderIsE2E of [false, true]) {
      const { sb, trip } = fleet({ profileFailure })
      const result = await loadNearTermOffer(sb, { pickup: PICKUP, now: NOW, riderIsE2E })
      if (riderIsE2E) assert.equal(result.availableDrivers, 0)
      else assert.ok(result.availableDrivers > 0)
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
    assert.equal(res.body.availableDrivers, e2e ? 1 : 0)
  }
})
