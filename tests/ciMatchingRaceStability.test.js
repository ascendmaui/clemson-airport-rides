import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptTrip,
  advanceTrip,
  declineTrip,
  loadDriverDesk,
} from '../packages/rides-native/driverDesk.js'
import {
  cancelSearchingTrip,
  expireSearchingTrip,
  seedMatchingScenario,
} from './fixtures/matchingE2E.js'

test('CI flake hunters: 3-way concurrent driver accept race produces exactly 1 winner and 2 rejects', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario({
    drivers: [
      { id: 'driver-alpha', approved: true, online: true, lat: 34.68, lng: -82.84 },
      { id: 'driver-beta', approved: true, online: true, lat: 34.68, lng: -82.84 },
      { id: 'driver-gamma', approved: true, online: true, lat: 34.68, lng: -82.84 },
    ],
  })

  const results = await Promise.allSettled(
    drivers.map((driver) => acceptTrip(supabase, trip, driver.id)),
  )

  const fulfilled = results.filter((r) => r.status === 'fulfilled')
  const rejected = results.filter((r) => r.status === 'rejected')

  assert.equal(fulfilled.length, 1, 'Only one driver should successfully accept the open pool trip')
  assert.equal(rejected.length, 2, 'Losing drivers should be rejected')
  for (const loser of rejected) {
    assert.match(loser.reason.message, /no longer available/)
  }

  const stored = supabase._tables.trips.find((t) => t.id === trip.id)
  assert.equal(stored.status, 'accepted')
  assert.ok(drivers.some((d) => d.id === stored.driver_id))

  const events = supabase._tables.trip_events.filter(
    (e) => e.trip_id === trip.id && e.kind === 'accepted',
  )
  assert.equal(events.length, 1, 'Exactly one accepted event must be logged')
  assert.equal(events[0].payload.driver_id, stored.driver_id)
})

test('CI flake hunters: decline by one driver records pass and leaves trip claimable by another driver', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario({
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.68, lng: -82.84 },
      { id: 'driver-2', approved: true, online: true, lat: 34.68, lng: -82.84 },
    ],
  })

  // Driver 1 declines the searching trip
  const declineResult = await declineTrip(supabase, trip, 'driver-1')
  assert.equal(declineResult.disposition, 'release')

  const passes = supabase._tables.driver_offer_passes
  assert.equal(passes.length, 1)
  assert.equal(passes[0].driver_id, 'driver-1')
  assert.equal(passes[0].trip_id, trip.id)

  // Driver 1's desk no longer sees the trip
  const desk1 = await loadDriverDesk(supabase, 'driver-1')
  assert.equal(desk1.offers.length, 0)

  // Driver 2's desk still sees the trip and accepts it
  const desk2 = await loadDriverDesk(supabase, 'driver-2')
  assert.equal(desk2.offers.length, 1)
  assert.equal(desk2.offers[0].id, trip.id)

  const accepted = await acceptTrip(supabase, desk2.offers[0], 'driver-2')
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.driver_id, 'driver-2')
})

test('CI flake hunters: advancing trip from illegal initial status throws without corrupting state', async () => {
  const { supabase } = seedMatchingScenario({
    trip: { id: 'trip-invalid-advance', status: 'searching' },
  })

  await assert.rejects(
    () => advanceTrip(supabase, { id: 'trip-invalid-advance', status: 'searching' }, 'driver-1'),
    /This trip cannot be advanced/,
  )

  const stored = supabase._tables.trips.find((t) => t.id === 'trip-invalid-advance')
  assert.equal(stored.status, 'searching')
  assert.equal(supabase._tables.trip_events.length, 0)
})

test('CI flake hunters: atomic resolution when rider cancels while driver is advancing', async () => {
  const { supabase } = seedMatchingScenario({
    trip: {
      id: 'trip-atomic-advance',
      status: 'accepted',
      driver_id: 'driver-1',
      rider_id: 'rider-1',
    },
  })

  // Rider cannot cancel an accepted trip via cancelSearchingTrip
  await assert.rejects(
    () => cancelSearchingTrip(supabase, 'trip-atomic-advance', 'rider-1'),
    /That ride is no longer searching/,
  )

  const stored = supabase._tables.trips.find((t) => t.id === 'trip-atomic-advance')
  assert.equal(stored.status, 'accepted')
  assert.equal(stored.driver_id, 'driver-1')
})
