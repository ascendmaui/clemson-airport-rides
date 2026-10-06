import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptTrip,
  loadDriverDesk,
} from '../packages/rides-native/driverDesk.js'
import {
  seedMatchingScenario,
} from './fixtures/matchingE2E.js'

test('driver can accept a trip in requested status', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario({
    tripId: 'trip-requested-1',
    riderId: 'rider-1',
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.6801, lng: -82.8412 },
    ],
    trip: {
      status: 'requested',
      driver_id: null,
    },
  })
  const driverId = drivers[0].id

  const desk = await loadDriverDesk(supabase, driverId)
  // In requested status, the trip may not appear in offers? Let's see.
  // Actually, the driverDesk likely only shows searching trips.
  // We need to check the behavior.
  // For now, we just test that acceptTrip works and updates the trip.
  const accepted = await acceptTrip(supabase, trip, driverId)
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.driver_id, driverId)
  assert.match(accepted.accepted_at, /^\d{4}-\d{2}-\d{2}T/)

  const events = supabase._tables.trip_events.filter((event) => event.trip_id === trip.id)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'accepted')
  assert.equal(events[0].payload.driver_id, driverId)

  const refreshedDesk = await loadDriverDesk(supabase, driverId)
  // After acceptance, the trip should no longer be in offers (since it's accepted)
  assert.deepEqual(refreshedDesk.offers, [])
})
