import assert from 'node:assert/strict'
import test from 'node:test'
import { notifyScheduledBoard } from './scheduledBoardAlerts.js'
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

for (const identity of [{ riderIsE2E: false }, { riderIsE2E: true }, { metadata: true }, { email: true }]) {
  test(`board alerts isolate driver groups: ${JSON.stringify(identity)}`, async () => {
    const { sb, trip } = fleet()
    if (identity.metadata) trip.metadata.e2e_test = true
    if (identity.email) sb._tables.profiles.find(row => row.id === trip.rider_id).email = 'e2e+rider@clemsonrides.com'
    const result = await notifyScheduledBoard(sb, { trip, riderIsE2E: identity.riderIsE2E })
    assert.equal(result.ok, true)
    assert.equal(result.drivers, 1)
    assert.deepEqual(sb._tables.driver_offer_alerts.map(row => row.driver_id), [identity.riderIsE2E || identity.metadata || identity.email ? 'e2e' : 'real'])
  })
}
test('unknown rider defaults to real and demo-only fleet never receives alerts', async () => {
  const { sb, trip } = fleet()
  delete trip.rider_id
  await notifyScheduledBoard(sb, { trip })
  assert.deepEqual(sb._tables.driver_offer_alerts.map(row => row.driver_id), ['real'])
  for (const riderIsE2E of [false, true]) {
    const demo = fleet({ only: 'demo-marcus' })
    const result = await notifyScheduledBoard(demo.sb, { trip: demo.trip, riderIsE2E })
    assert.equal(result.drivers, 0)
  }
})

for (const profileFailure of ['error', 'throw']) {
  test(`profile ${profileFailure} fails closed for test riders and open for real riders without failing the request`, async () => {
    for (const riderIsE2E of [false, true]) {
      const { sb, trip } = fleet({ profileFailure })
      const result = await notifyScheduledBoard(sb, { trip, riderIsE2E })
      if (riderIsE2E) assert.equal(result.drivers, 0)
      else assert.ok(result.drivers > 0)
      assert.equal(result.ok, true)
    }
  })
}
