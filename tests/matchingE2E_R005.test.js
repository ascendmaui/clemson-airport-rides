import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadDriverDesk,
  acceptTrip,
} from '../packages/rides-native/driverDesk.js'
import {
  seedMatchingScenario,
} from './fixtures/matchingE2E.js'

test('driver desk correctly handles trips of different tiers (standard vs tesla)', async () => {
  const { supabase, trip: standardTrip, drivers } = seedMatchingScenario({
    tripId: 'trip-standard-1',
    riderId: 'rider-1',
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.6801, lng: -82.8412 },
      { id: 'driver-2', approved: true, online: true, lat: 34.6812, lng: -82.8401 },
    ],
    trip: {
      tier: 'standard',
    },
  })
  // Add a tesla tier trip manually
  const teslaTrip = {
    id: 'trip-tesla-1',
    rider_id: 'rider-2',
    driver_id: null,
    status: 'searching',
    tier: 'tesla',
    pickup_label: 'Memorial Stadium',
    dropoff_label: 'GSP Airport',
    pickup_lat: 34.6834,
    pickup_lng: -82.8374,
    dropoff_lat: 34.8957,
    dropoff_lng: -82.2189,
    requested_at: '2026-10-01T08:00:00.000Z',
    metadata: { tesla: true, fleet: 'tesla_model_3' }, // appropriate metadata for tesla
  }
  supabase._tables.trips.push(teslaTrip)
  // Add a profile for the second rider
  supabase._tables.profiles.push({ id: 'rider-2', full_name: 'Fixture Rider 2' })

  const driverId = drivers[0].id
  const driver2Id = drivers[1].id

  // Verify driver desk shows both trips with correct tier
  let desk = await loadDriverDesk(supabase, driverId)
  assert.equal(desk.offers.length, 2)
  const offerIds = new Set(desk.offers.map(o => o.id))
  assert.equal(offerIds.has(standardTrip.id), true)
  assert.equal(offerIds.has(teslaTrip.id), true)

  // Check that each offer has the correct tier
  const standardOffer = desk.offers.find(o => o.id === standardTrip.id)
  const teslaOffer = desk.offers.find(o => o.id === teslaTrip.id)
  assert.equal(standardOffer.tier, 'standard')
  assert.equal(teslaOffer.tier, 'tesla')

  // For tesla offer, check metadata (if exposed in the offer object)
  // Note: the offer object might not include the full metadata, but we can check the trip in the database
  const teslaTripInDb = supabase._tables.trips.find(t => t.id === teslaTrip.id)
  assert.equal(teslaTripInDb.tier, 'tesla')
  assert.equal(teslaTripInDb.metadata.tesla, true)
  assert.equal(teslaTripInDb.metadata.fleet, 'tesla_model_3')

  // Verify that multiple drivers can see trips of both tiers simultaneously
  let desk2 = await loadDriverDesk(supabase, driver2Id)
  assert.equal(desk2.offers.length, 2)
  const offerIds2 = new Set(desk2.offers.map(o => o.id))
  assert.equal(offerIds2.has(standardTrip.id), true)
  assert.equal(offerIds2.has(teslaTrip.id), true)

  // Test that drivers can accept trips of both tiers
  // Driver 1 accepts the standard trip
  const acceptedStandard = await acceptTrip(supabase, standardOffer, driverId)
  assert.equal(acceptedStandard.status, 'accepted')
  assert.equal(acceptedStandard.driver_id, driverId)
  assert.equal(acceptedStandard.tier, 'standard')

  // Driver 2 accepts the tesla trip
  const acceptedTesla = await acceptTrip(supabase, teslaOffer, driver2Id)
  assert.equal(acceptedTesla.status, 'accepted')
  assert.equal(acceptedTesla.driver_id, driver2Id)
  assert.equal(acceptedTesla.tier, 'tesla')

  // Verify that the trips are now accepted
  const acceptedStandardTrip = supabase._tables.trips.find(t => t.id === standardTrip.id)
  assert.equal(acceptedStandardTrip.status, 'accepted')
  assert.equal(acceptedStandardTrip.driver_id, driverId)
  assert.equal(acceptedStandardTrip.tier, 'standard')

  const acceptedTeslaTrip = supabase._tables.trips.find(t => t.id === teslaTrip.id)
  assert.equal(acceptedTeslaTrip.status, 'accepted')
  assert.equal(acceptedTeslaTrip.driver_id, driver2Id)
  assert.equal(acceptedTeslaTrip.tier, 'tesla')
  assert.equal(acceptedTeslaTrip.metadata.tesla, true)
  assert.equal(acceptedTeslaTrip.metadata.fleet, 'tesla_model_3')

  // Verify that accepted events were written
  const acceptedEvents = supabase._tables.trip_events.filter(
    (event) => event.kind === 'accepted'
  )
  assert.equal(acceptedEvents.length, 2)
  const standardEvent = acceptedEvents.find(e => e.payload.driver_id === driverId)
  const teslaEvent = acceptedEvents.find(e => e.payload.driver_id === driver2Id)
  assert.equal(standardEvent?.payload.driver_id, driverId)
  assert.equal(teslaEvent?.payload.driver_id, driver2Id)
})
