import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptTrip,
} from '../packages/rides-native/driverDesk.js'
import {
  cancelSearchingTrip,
  seedMatchingScenario,
} from './fixtures/matchingE2E.js'

test('R001: rider cancels searching trip; no driver accept can succeed afterward', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario({
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.68, lng: -82.84 },
    ],
  })

  // Rider cancels the searching trip
  await cancelSearchingTrip(supabase, trip.id, trip.rider_id)

  // Verify trip is now canceled
  const storedTrip = supabase._tables.trips.find((t) => t.id === trip.id)
  assert.equal(storedTrip.status, 'canceled')

  // Attempt to accept the trip by the driver should fail
  await assert.rejects(
    () => acceptTrip(supabase, storedTrip, drivers[0].id),
    /That ride is no longer available/
  )

  // Ensure no accept event was logged
  const acceptEvents = supabase._tables.trip_events.filter(
    (e) => e.trip_id === trip.id && e.kind === 'accepted',
  )
  assert.equal(acceptEvents.length, 0, 'No accept event should be logged after cancellation')
})
