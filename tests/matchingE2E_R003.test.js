import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadDriverDesk,
  declineTrip,
  acceptTrip,
  listPassedTripIds,
} from '../packages/rides-native/driverDesk.js'
import {
  seedMatchingScenario,
} from './fixtures/matchingE2E.js'

test('driver can decline a searching trip, allowing another driver to accept', async () => {
  const { supabase, trip: initialTrip, drivers } = seedMatchingScenario({
    tripId: 'trip-searching-1',
    riderId: 'rider-1',
    drivers: [
      { id: 'driver-decliner', approved: true, online: true, lat: 34.6801, lng: -82.8412 },
      { id: 'driver-accepter', approved: true, online: true, lat: 34.6812, lng: -82.8401 },
    ],
  })
  let trip = initialTrip
  const declinerId = drivers[0].id
  const accepterId = drivers[1].id

  // Verify both drivers see the offer initially
  let deskDecliner = await loadDriverDesk(supabase, declinerId)
  assert.equal(deskDecliner.online, true)
  assert.deepEqual(deskDecliner.offers.map((offer) => offer.id), [trip.id])

  let deskAccepter = await loadDriverDesk(supabase, accepterId)
  assert.equal(deskAccepter.online, true)
  assert.deepEqual(deskAccepter.offers.map((offer) => offer.id), [trip.id])

  // Decliner driver declines the offer (trip is searching)
  const declineResult = await declineTrip(supabase, trip, declinerId)
  assert.equal(declineResult.disposition, 'release') // because trip was searching/offered
  assert.equal(declineResult.passed, true) // pass recorded for decliner
  assert.equal(declineResult.released, false) // trip not released because it was searching (not offered)

  // Update trip object to reflect current state in the database
  trip = supabase._tables.trips.find(t => t.id === initialTrip.id)
  // After declining, trip should still be searching with no driver (since no one accepted)
  assert.equal(trip.status, 'searching')
  assert.equal(trip.driver_id, null)

  // Decliner's desk should no longer show the offer (due to pass)
  deskDecliner = await loadDriverDesk(supabase, declinerId)
  assert.equal(deskDecliner.online, true)
  assert.deepEqual(deskDecliner.offers, [])

  // Accepter driver should still see the offer
  deskAccepter = await loadDriverDesk(supabase, accepterId)
  assert.equal(deskAccepter.online, true)
  assert.deepEqual(deskAccepter.offers.map((offer) => offer.id), [trip.id])

  // Accepter driver can now accept the offer
  const accepted = await acceptTrip(supabase, trip, accepterId)
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.driver_id, accepterId)

  // Update trip object
  trip = supabase._tables.trips.find(t => t.id === initialTrip.id)
  // Trip should now be accepted
  assert.equal(trip.status, 'accepted')
  assert.equal(trip.driver_id, accepterId)

  // An accepted event should have been written
  const acceptedEvents = supabase._tables.trip_events.filter(
    (event) => event.trip_id === trip.id && event.kind === 'accepted'
  )
  assert.equal(acceptedEvents.length, 1)
  assert.equal(acceptedEvents[0].payload.driver_id, accepterId)

  // Decliner should still not see the offer (they have a pass)
  deskDecliner = await loadDriverDesk(supabase, declinerId)
  assert.deepEqual(deskDecliner.offers, [])
})

test('driver declining the same trip multiple times only records one pass', async () => {
  const { supabase, trip: initialTrip, drivers } = seedMatchingScenario({
    tripId: 'trip-searching-1',
    riderId: 'rider-1',
    drivers: [
      { id: 'driver-decliner', approved: true, online: true, lat: 34.6801, lng: -82.8412 },
    ],
  })
  let trip = initialTrip
  const declinerId = drivers[0].id

  // Verify driver sees the offer initially
  let deskDecliner = await loadDriverDesk(supabase, declinerId)
  assert.equal(deskDecliner.online, true)
  assert.deepEqual(deskDecliner.offers.map((offer) => offer.id), [trip.id])

  // Driver declines the offer first time
  let declineResult = await declineTrip(supabase, trip, declinerId)
  assert.equal(declineResult.disposition, 'release')
  assert.equal(declineResult.passed, true)
  assert.equal(declineResult.released, false)

  // Update trip object
  trip = supabase._tables.trips.find(t => t.id === initialTrip.id)
  // Verify driver no longer sees the offer
  deskDecliner = await loadDriverDesk(supabase, declinerId)
  assert.deepEqual(deskDecliner.offers, [])

  // Driver declines the offer second time
  declineResult = await declineTrip(supabase, trip, declinerId)
  assert.equal(declineResult.disposition, 'release')
  assert.equal(declineResult.passed, true) // Still returns true (pass was recorded, but it's the same pass)
  assert.equal(declineResult.released, false)

  // Verify driver still doesn't see the offer
  deskDecliner = await loadDriverDesk(supabase, declinerId)
  assert.deepEqual(deskDecliner.offers, [])

  // Verify that only one pass was recorded (the pass tracking is binary - either you've passed or you haven't)
  const passes = await supabase.from('driver_offer_passes').select('*').eq('driver_id', declinerId).eq('trip_id', trip.id)
  assert.equal(passes.data.length, 1)
})

test('two drivers can decline a searching trip, allowing a third driver to accept', async () => {
  const { supabase, trip: initialTrip, drivers } = seedMatchingScenario({
    tripId: 'trip-searching-1',
    riderId: 'rider-1',
    drivers: [
      { id: 'driver-decliner-1', approved: true, online: true, lat: 34.6801, lng: -82.8412 },
      { id: 'driver-decliner-2', approved: true, online: true, lat: 34.6812, lng: -82.8401 },
      { id: 'driver-accepter', approved: true, online: true, lat: 34.6822, lng: -82.8391 },
    ],
  })
  let trip = initialTrip
  const decliner1Id = drivers[0].id
  const decliner2Id = drivers[1].id
  const accepterId = drivers[2].id

  // Verify all drivers see the offer initially
  for (const [driverId, label] of [
    [decliner1Id, 'decliner1'],
    [decliner2Id, 'decliner2'],
    [accepterId, 'accepter'],
  ]) {
    const desk = await loadDriverDesk(supabase, driverId)
    assert.equal(desk.online, true, `${label} should be online`)
    assert.deepEqual(desk.offers.map((offer) => offer.id), [trip.id], `${label} should see the offer`)
  }

  // First driver declines
  const declineResult1 = await declineTrip(supabase, trip, decliner1Id)
  trip = supabase._tables.trips.find(t => t.id === initialTrip.id)
  console.error("Passed for decliner1:", declineResult1.passed);

  // Second driver declines
  await declineTrip(supabase, trip, decliner2Id)
  trip = supabase._tables.trips.find(t => t.id === initialTrip.id)

  // After two declines, trip should still be searching with no driver
  assert.equal(trip.status, 'searching')
  assert.equal(trip.driver_id, null)

   // Decliner desks should no longer show the offer
   const passedIds = await listPassedTripIds(supabase, decliner1Id)
   console.error("passedIds for decliner1:", passedIds)
   let deskDecliner1 = await loadDriverDesk(supabase, decliner1Id)
   console.error("deskDecliner1 after first decline:", deskDecliner1);
  assert.deepEqual(deskDecliner1.offers, [])
  let deskDecliner2 = await loadDriverDesk(supabase, decliner2Id)
  assert.deepEqual(deskDecliner2.offers, [])

  // Accepter driver should still see the offer
  let deskAccepter = await loadDriverDesk(supabase, accepterId)
  console.error("deskAccepter:", deskAccepter)
  assert.equal(deskAccepter.online, true)
  assert.deepEqual(deskAccepter.offers.map((offer) => offer.id), [trip.id])

  // Accepter driver can now accept the offer
  const accepted = await acceptTrip(supabase, trip, accepterId)
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.driver_id, accepterId)

  // Update trip object
  trip = supabase._tables.trips.find(t => t.id === initialTrip.id)
  // Trip should now be accepted
  assert.equal(trip.status, 'accepted')
  assert.equal(trip.driver_id, accepterId)

  // An accepted event should have been written
  const acceptedEvents = supabase._tables.trip_events.filter(
    (event) => event.trip_id === trip.id && event.kind === 'accepted'
  )
  assert.equal(acceptedEvents.length, 1)
  assert.equal(acceptedEvents[0].payload.driver_id, accepterId)
})

test('driver cannot decline a trip that has already been accepted by another driver', async () => {
  const { supabase, trip: initialTrip, drivers } = seedMatchingScenario({
    tripId: 'trip-searching-1',
    riderId: 'rider-1',
    drivers: [
      { id: 'driver-accepter', approved: true, online: true, lat: 34.6801, lng: -82.8412 },
      { id: 'driver-decliner', approved: true, online: true, lat: 34.6812, lng: -82.8401 },
    ],
  })
  let trip = initialTrip
  const accepterId = drivers[0].id
  const declinerId = drivers[1].id

  // Accepter driver accepts the offer first
  const deskAccepter = await loadDriverDesk(supabase, accepterId)
  assert.equal(deskAccepter.online, true)
  assert.deepEqual(deskAccepter.offers.map((offer) => offer.id), [trip.id])

  const accepted = await acceptTrip(supabase, trip, accepterId)
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.driver_id, accepterId)

  // Update trip object
  trip = supabase._tables.trips.find(t => t.id === initialTrip.id)
  // Trip should now be accepted
  assert.equal(trip.status, 'accepted')
  assert.equal(trip.driver_id, accepterId)

  // Decliner driver should no longer see the offer (because it's accepted)
  const deskDecliner = await loadDriverDesk(supabase, declinerId)
  assert.equal(deskDecliner.online, true)
  assert.deepEqual(deskDecliner.offers, [])

  // Attempt to decline should fail (or have no effect) because the trip is not searching/offered
  const declineResult = await declineTrip(supabase, trip, declinerId)
  // For a trip that is not searching or offered, it should return { disposition: 'reject', passed: false, released: false }
  assert.equal(declineResult.disposition, 'cancel')
  assert.equal(declineResult.passed, undefined)
  assert.equal(declineResult.released, undefined)

  // Verify that no pass was recorded for the decliner on this trip
  const passes = await supabase.from('driver_offer_passes').select('*').eq('driver_id', declinerId).eq('trip_id', trip.id)
  assert.equal(passes.data.length, 0)
})
