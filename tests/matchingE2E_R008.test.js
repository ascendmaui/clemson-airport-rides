import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptTrip,
  loadDriverDesk,
} from '../packages/rides-native/driverDesk.js'
import {
  seedMatchingScenario,
} from './fixtures/matchingE2E.js'

test('driver desk shows multiple concurrent searching trips as separate offers', async () => {
  // Seed two searching trips
  const { supabase, trip: trip1, drivers } = seedMatchingScenario({
    tripId: 'trip-searching-1',
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.6801, lng: -82.8412 },
    ],
  })
  // Manually add a second trip to the mock supabase
  const trip2 = {
    id: 'trip-searching-2',
    rider_id: 'rider-2',
    driver_id: null,
    status: 'searching',
    tier: 'standard',
    pickup_label: 'Memorial Stadium',
    dropoff_label: 'GSP Airport',
    pickup_lat: 34.6834,
    pickup_lng: -82.8374,
    dropoff_lat: 34.8957,
    dropoff_lng: -82.2189,
    requested_at: '2026-10-01T08:00:00.000Z',
    metadata: {},
  }
  supabase._tables.trips.push(trip2)
  // Also need a profile for the second rider
  supabase._tables.profiles.push({ id: 'rider-2', full_name: 'Fixture Rider 2' })

  const driverId = drivers[0].id

  // Load desk and verify both trips appear as offers
  let desk = await loadDriverDesk(supabase, driverId)
  assert.equal(desk.offers.length, 2)
  const offerIds = new Set(desk.offers.map(o => o.id))
  assert.equal(offerIds.has(trip1.id), true)
  assert.equal(offerIds.has(trip2.id), true)

  // Accept the first trip
  const accepted = await acceptTrip(supabase, desk.offers.find(o => o.id === trip1.id), driverId)
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.driver_id, driverId)

  // Load desk again: first trip should be in active, second trip still in offers
  desk = await loadDriverDesk(supabase, driverId)
  assert.equal(desk.active?.id, trip1.id)
  assert.equal(desk.offers.length, 1)
  assert.equal(desk.offers[0].id, trip2.id)
})

test('driver can accept either of multiple concurrent searching trips', async () => {
  // Seed two searching trips
  const { supabase, trip: trip1, drivers } = seedMatchingScenario({
    tripId: 'trip-searching-1',
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.6801, lng: -82.8412 },
    ],
  })
  const trip2 = {
    id: 'trip-searching-2',
    rider_id: 'rider-2',
    driver_id: null,
    status: 'searching',
    tier: 'standard',
    pickup_label: 'Memorial Stadium',
    dropoff_label: 'GSP Airport',
    pickup_lat: 34.6834,
    pickup_lng: -82.8374,
    dropoff_lat: 34.8957,
    dropoff_lng: -82.2189,
    requested_at: '2026-10-01T08:00:00.000Z',
    metadata: {},
  }
  supabase._tables.trips.push(trip2)
  supabase._tables.profiles.push({ id: 'rider-2', full_name: 'Fixture Rider 2' })

  const driverId = drivers[0].id

  // Load desk
  let desk = await loadDriverDesk(supabase, driverId)
  assert.equal(desk.offers.length, 2)

  // Accept the second trip
  const accepted = await acceptTrip(supabase, desk.offers.find(o => o.id === trip2.id), driverId)
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.driver_id, driverId)

  // Desk: second trip in active, first trip still in offers
  desk = await loadDriverDesk(supabase, driverId)
  assert.equal(desk.active?.id, trip2.id)
  assert.equal(desk.offers.length, 1)
  assert.equal(desk.offers[0].id, trip1.id)
})

test('driver desk does not show completed trips as offers', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario({
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.6801, lng: -82.8412 },
    ],
  })
  const driverId = drivers[0].id

  // Verify initial state: driver sees the searching trip in offers
  let desk = await loadDriverDesk(supabase, driverId)
  assert.equal(desk.offers.length, 1)
  assert.equal(desk.offers[0].id, trip.id)

  // Update trip status to completed
  const completedAt = new Date().toISOString()
  trip.status = 'completed'
  trip.driver_id = driverId
  trip.completed_at = completedAt
  // Update in _tables
  const tripIndex = supabase._tables.trips.findIndex(t => t.id === trip.id)
  if (tripIndex !== -1) {
    supabase._tables.trips[tripIndex] = trip
  }

  // Get the desk after completion
  desk = await loadDriverDesk(supabase, driverId)
  
  // Should have no offers
  assert.equal(desk.offers.length, 0)
  
  // Should have no active trip (since we didn't accept it)
  assert.equal(desk.active, null)
})
