import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadDriverDesk,
  declineTrip,
  acceptTrip,
} from '../packages/rides-native/driverDesk.js'
import {
  seedMatchingScenario,
  cancelSearchingTrip,
  requestDriverTrip,
} from './fixtures/matchingE2E.js'

test('driver who declined a canceled trip can be offered a new trip', async () => {
  const { supabase, trip: trip1, drivers } = seedMatchingScenario({
    tripId: 'trip-searching-1',
    riderId: 'rider-1',
    drivers: [
      { id: 'driver-decliner', approved: true, online: true, lat: 34.6801, lng: -82.8412 },
    ],
  })
  const declinerId = drivers[0].id

  // First, have the driver decline the initial trip (while it's searching)
  await declineTrip(supabase, trip1, declinerId)

  // Verify driver no longer sees the original trip
  let desk = await loadDriverDesk(supabase, declinerId)
  assert.deepEqual(desk.offers, [])

  // Now, cancel the original trip (simulate rider canceling while searching)
  await cancelSearchingTrip(supabase, trip1.id, trip1.rider_id)

  // Verify the original trip is canceled
  const canceledTrip = supabase._tables.trips.find(t => t.id === trip1.id)
  assert.equal(canceledTrip.status, 'canceled')

  // Now, request a new trip (trip2) from the same rider
  const newTrip = await requestDriverTrip(supabase, {
    id: 'trip-searching-2',
    riderId: 'rider-1',
    pickupLabel: 'Memorial Stadium',
    dropoffLabel: 'Downtown Clemson',
    requestedAt: '2026-10-01T08:05:00.000Z', // a bit later
  })

  // Verify the new trip is searching
  assert.equal(newTrip.status, 'searching')

  // Now, the driver who declined the first (now canceled) trip should be able to see and accept the new trip
  desk = await loadDriverDesk(supabase, declinerId)
  assert.equal(desk.online, true)
  assert.deepEqual(desk.offers.map((offer) => offer.id), [newTrip.id])

  // Driver can accept the new trip
  const accepted = await acceptTrip(supabase, newTrip, declinerId)
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.driver_id, declinerId)

  // Verify the trip is now accepted
  const acceptedTrip = supabase._tables.trips.find(t => t.id === newTrip.id)
  assert.equal(acceptedTrip.status, 'accepted')
  assert.equal(acceptedTrip.driver_id, declinerId)
})
