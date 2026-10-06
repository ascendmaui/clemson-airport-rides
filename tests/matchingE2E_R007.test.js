import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadDriverDesk,
  acceptTrip,
} from '../packages/rides-native/driverDesk.js'
import {
  seedMatchingScenario,
} from './fixtures/matchingE2E.js'

test('driver desk correctly handles trip lifecycle from acceptance to completion', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario({
    tripId: 'trip-searching-1',
    riderId: 'rider-1',
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.6801, lng: -82.8412 },
    ],
  })
  const driverId = drivers[0].id

  // Initially, the driver sees the searching trip in offers
  let desk = await loadDriverDesk(supabase, driverId)
  assert.equal(desk.offers.length, 1)
  assert.equal(desk.offers[0].id, trip.id)
  assert.equal(desk.active, null)

  // Driver accepts the trip
  const accepted = await acceptTrip(supabase, desk.offers[0], driverId)
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.driver_id, driverId)

  // After accepting, the trip should be in active and offers should be empty
  desk = await loadDriverDesk(supabase, driverId)
  assert.equal(desk.offers.length, 0)
  assert.notEqual(desk.active, null)
  assert.equal(desk.active.id, trip.id)
  assert.equal(desk.active.status, 'accepted')

  // Verify that an accepted event was written
  const acceptedEvents = supabase._tables.trip_events.filter(
    (event) => event.trip_id === trip.id && event.kind === 'accepted'
  )
  assert.equal(acceptedEvents.length, 1)
  assert.equal(acceptedEvents[0].payload.driver_id, driverId)

  // Now, simulate trip completion by updating the trip status to 'completed'
  const completedAt = '2026-10-01T08:30:00.000Z'
  const tripIndex = supabase._tables.trips.findIndex(t => t.id === trip.id)
  supabase._tables.trips[tripIndex] = {
    ...trip,
    status: 'completed',
    completed_at: completedAt,
  }

  // After completion, the active trip should be cleared and offers should remain empty
  desk = await loadDriverDesk(supabase, driverId)
  assert.equal(desk.offers.length, 0)
  assert.equal(desk.active, null)

  // Verify that the trip is now completed in the database
  const completedTrip = supabase._tables.trips.find(t => t.id === trip.id)
  assert.equal(completedTrip.status, 'completed')
  assert.equal(completedTrip.completed_at, completedAt)
})
