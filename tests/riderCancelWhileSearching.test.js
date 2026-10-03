import assert from 'node:assert/strict'
import test from 'node:test'
import { acceptTrip } from '../packages/rides-native/driverDesk.js'
import { cancelSearchingTrip, seedMatchingScenario } from './fixtures/matchingE2E.js'

test('Rider cancels searching trip; driver accept cannot succeed afterward', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario({
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.68, lng: -82.84 },
    ],
  })

  // Rider cancels the searching trip
  const cancelResult = await cancelSearchingTrip(supabase, trip.id, 'rider-1')
  assert.equal(cancelResult.status, 'canceled')

  // Ensure trip is no longer searching or offered
  const stored = supabase._tables.trips.find((t) => t.id === trip.id)
  assert.equal(stored.status, 'canceled')

  // Driver attempts to accept the canceled trip
  await assert.rejects(
    () => acceptTrip(supabase, trip, 'driver-1'),
    /That ride is no longer searching/,
  )

  // Ensure no accepted event was recorded
  const events = supabase._tables.trip_events.filter(
    (e) => e.trip_id === trip.id && e.kind === 'accepted',
  )
  assert.equal(events.length, 0, 'No accepted event should be logged after cancellation')
})
