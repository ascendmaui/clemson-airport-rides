import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadDriverDesk,
  acceptTrip,
} from '../packages/rides-native/driverDesk.js'
import {
  seedMatchingScenario,
} from './fixtures/matchingE2E.js'

test('approved online driver does not see a trip accepted by another driver', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario({
    tripId: 'trip-searching-1',
    riderId: 'rider-1',
    drivers: [
      { id: 'driver-accepter', approved: true, online: true, lat: 34.6801, lng: -82.8412 },
      { id: 'driver-observer', approved: true, online: true, lat: 34.6812, lng: -82.8401 },
    ],
  })
  const accepterId = drivers[0].id
  const observerId = drivers[1].id

  // Observer driver should initially see the trip in offers
  let deskObserver = await loadDriverDesk(supabase, observerId)
  assert.deepEqual(deskObserver.offers.map((offer) => offer.id), [trip.id])

  // Accepter driver accepts the trip
  await acceptTrip(supabase, trip, accepterId)

  // Update trip object from the mock supabase
  const updatedTrip = supabase._tables.trips.find(t => t.id === trip.id)
  assert.equal(updatedTrip.status, 'accepted')
  assert.equal(updatedTrip.driver_id, accepterId)

  // Observer driver should no longer see the trip in any tab (offers, upcoming, active)
  deskObserver = await loadDriverDesk(supabase, observerId)
  assert.deepEqual(deskObserver.offers, [], 'Observer should not see the trip in offers')
  assert.deepEqual(deskObserver.upcoming, [], 'Observer should not see the trip in upcoming')
  assert.deepEqual(deskObserver.active, null, 'Observer should not see the trip in active')

  // The accepter driver should see the trip in active
  const deskAccepter = await loadDriverDesk(supabase, accepterId)
  assert.equal(deskAccepter.active?.id, trip.id, 'Accepter should see the trip in active')
  assert.equal(deskAccepter.active?.driverId, accepterId, 'Accepter should see the trip with correct driverId')
})
