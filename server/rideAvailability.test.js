import assert from 'node:assert/strict'
import test from 'node:test'
import { assertTierAvailable, loadRideAvailability } from './rideAvailability.js'

function table(rows) {
  return {
    data: rows,
    error: null,
    select() { return this },
    in() { return this },
    eq() { return this },
  }
}

function client({ applications, vehicles, status, trips, profiles = applications.map(row => ({ id: row.profile_id, email: `${row.profile_id}@example.com` })) }) {
  const tables = {
    driver_applications: table(applications),
    vehicles: table(vehicles),
    driver_status: table(status),
    trips: table(trips),
    profiles: table(profiles),
  }
  return {
    from(name) {
      const found = tables[name]
      if (!found) throw new Error(`unexpected table ${name}`)
      return found
    },
  }
}

const NOW = new Date('2026-10-05T15:00:00.000Z')
const LATER = '2026-10-05T20:00:00.000Z'

test('now mode hides comfort when the only online driver is a standard vehicle', async () => {
  const sb = client({
    applications: [{ profile_id: 'a', onboarding_status: 'approved' }],
    vehicles: [{ driver_id: 'a', service_class: 'standard', tier: 'standard' }],
    status: [{ driver_id: 'a', online: true }],
    trips: [],
  })
  const snapshot = await loadRideAvailability(sb, { now: NOW })
  assert.equal(snapshot.mode, 'now')
  assert.equal(snapshot.basis, 'online_available')
  assert.deepEqual(snapshot.availableTierIds, ['standard', 'wait', 'carpool'])
  assert.equal(snapshot.tiers.some((row) => row.id === 'comfort'), false)
  assert.equal(snapshot.tiers.some((row) => row.id === 'carpool'), true)
  assert.equal(snapshot.empty, false)
  assert.equal(snapshot.pollSeconds, 10)
})

test('a busy or offline approved driver does not keep a tier on the list', async () => {
  const sb = client({
    applications: [
      { profile_id: 'busy', onboarding_status: 'approved' },
      { profile_id: 'off', onboarding_status: 'approved' },
      { profile_id: 'pending', onboarding_status: 'pending_review' },
    ],
    vehicles: [
      { driver_id: 'busy', service_class: 'comfort' },
      { driver_id: 'off', service_class: 'comfort' },
    ],
    status: [
      { driver_id: 'busy', online: true },
      { driver_id: 'off', online: false },
    ],
    trips: [{ driver_id: 'busy', status: 'in_progress', pickup_at: null, scheduled_for: null }],
  })
  const snapshot = await loadRideAvailability(sb, { now: NOW })
  assert.deepEqual(snapshot.availableTierIds, [])
  assert.equal(snapshot.emptyMessage, 'No drivers available right now')
  await assert.rejects(
    () => assertTierAvailable(sb, 'standard', { now: NOW }),
    /not available right now/,
  )
})

test('scheduled mode keeps comfort for an offline approved vehicle and drops a booked driver', async () => {
  const sb = client({
    applications: [
      { profile_id: 'booked', onboarding_status: 'approved' },
      { profile_id: 'free', onboarding_status: 'approved' },
    ],
    vehicles: [
      { driver_id: 'booked', service_class: 'comfort' },
      { driver_id: 'free', service_class: 'standard' },
    ],
    status: [
      { driver_id: 'booked', online: false },
      { driver_id: 'free', online: false },
    ],
    trips: [{
      driver_id: 'booked',
      status: 'scheduled',
      pickup_at: '2026-10-05T20:20:00.000Z',
      scheduled_for: '2026-10-05T20:20:00.000Z',
    }],
  })
  const snapshot = await loadRideAvailability(sb, { scheduledFor: LATER, now: NOW })
  assert.equal(snapshot.mode, 'scheduled')
  assert.equal(snapshot.futureAvailabilitySignal, false)
  assert.match(snapshot.limitation, /no driver shift plan/i)
  assert.deepEqual(snapshot.availableTierIds, ['standard', 'wait', 'carpool'])
  await assert.rejects(
    () => assertTierAvailable(sb, 'comfort', { scheduledFor: LATER, now: NOW }),
    /not available for this pickup time/,
  )
  const ok = await assertTierAvailable(sb, 'wait', { scheduledFor: LATER, now: NOW })
  assert.equal(ok.availableTierIds.includes('wait'), true)
})

test('missing service class column still reads tier', async () => {
  const vehicles = {
    data: [{ driver_id: 'a', tier: 'comfort' }],
    error: null,
    select(columns) {
      if (String(columns).includes('service_class')) {
        return {
          data: null,
          error: { message: 'column service_class does not exist' },
          in() { return this },
        }
      }
      return this
    },
    in() { return this },
  }
  const sb = {
    from(name) {
      if (name === 'profiles') return table([{ id: 'a', email: 'a@example.com' }])
      if (name === 'vehicles') return vehicles
      if (name === 'driver_applications') {
        return table([{ profile_id: 'a', onboarding_status: 'approved' }])
      }
      if (name === 'driver_status') return table([{ driver_id: 'a', online: true }])
      if (name === 'trips') return table([])
      throw new Error(name)
    },
  }
  const snapshot = await loadRideAvailability(sb, { now: NOW })
  assert.deepEqual(snapshot.availableTierIds, ['standard', 'wait', 'comfort', 'carpool'])
})
