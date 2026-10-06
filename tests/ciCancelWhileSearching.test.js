import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptTrip,
  loadDriverDesk,
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

test('R001: rider cancels offered trip; no driver accept can succeed afterward', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario({
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.68, lng: -82.84 },
    ],
  })

  // Manually set trip status to offered to simulate an offer being made
  const tripIdx = supabase._tables.trips.findIndex(t => t.id === trip.id)
  supabase._tables.trips[tripIdx].status = 'offered'

  // Rider cancels the offered trip
  const canceled = await cancelSearchingTrip(supabase, trip.id, trip.rider_id)

  // Verify trip is now canceled
  assert.equal(canceled.status, 'canceled')
  assert.equal(canceled.driver_id, null)

  // Ensure no accept event was logged (and a canceled event is logged)
  const acceptEvents = supabase._tables.trip_events.filter(
    (e) => e.trip_id === trip.id && e.kind === 'accepted',
  )
  assert.equal(acceptEvents.length, 0, 'No accept event should be logged after cancellation')

  const cancelEvents = supabase._tables.trip_events.filter(
    (e) => e.trip_id === trip.id && e.kind === 'canceled',
  )
  assert.equal(cancelEvents.length, 1, 'Exactly one canceled event should be logged')
  assert.equal(cancelEvents[0].payload.reason, 'rider_cancel')
  assert.equal(cancelEvents[0].payload.source, 'rider_app')
})

test('R001: canceling an already canceled trip throws error', async () => {
  const { supabase, trip } = seedMatchingScenario({
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.68, lng: -82.84 },
    ],
  })

  // First cancel the trip
  await cancelSearchingTrip(supabase, trip.id, trip.rider_id)

  // Attempt to cancel again should throw
  await assert.rejects(
    () => cancelSearchingTrip(supabase, trip.id, trip.rider_id),
    /That ride is no longer searching/
  )
})

test('R001: canceling a trip in invalid status throws error', async () => {
  const { supabase, trip } = seedMatchingScenario({
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.68, lng: -82.84 },
    ],
  })

  // Test various invalid statuses for cancellation
  const invalidStatuses = ['accepted', 'in_progress', 'arrived', 'completed']
  
  for (const status of invalidStatuses) {
    // Reset trip to searching status first
    const tripIdx = supabase._tables.trips.findIndex(t => t.id === trip.id)
    supabase._tables.trips[tripIdx].status = 'searching'
    
    // Set to invalid status
    supabase._tables.trips[tripIdx].status = status
    
    // Attempt to cancel should throw
    await assert.rejects(
      () => cancelSearchingTrip(supabase, trip.id, trip.rider_id),
      /That ride is no longer searching/
    )
  }
})

test('R001: different rider cannot cancel trip', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario({
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.68, lng: -82.84 },
    ],
  })

  // Attempt to cancel by a different rider should fail
  await assert.rejects(
    () => cancelSearchingTrip(supabase, trip.id, 'different-rider-id'),
    /That ride is no longer searching/
  )
})

test('R001: after cancellation, multiple drivers cannot accept trip', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario({
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.68, lng: -82.84 },
      { id: 'driver-2', approved: true, online: true, lat: 34.69, lng: -82.85 },
      { id: 'driver-3', approved: true, online: true, lat: 34.70, lng: -82.86 },
    ],
  })

  // Get the riderId from the seeded scenario
  const riderId = trip.rider_id

  // Rider cancels the searching trip
  await cancelSearchingTrip(supabase, trip.id, riderId)

  // Verify trip is now canceled
  const storedTrip = supabase._tables.trips.find((t) => t.id === trip.id)
  assert.equal(storedTrip.status, 'canceled')

  // All drivers should fail to accept the trip
  await assert.rejects(
    () => acceptTrip(supabase, storedTrip, 'driver-1'),
    /That ride is no longer available/
  )
  await assert.rejects(
    () => acceptTrip(supabase, storedTrip, 'driver-2'),
    /That ride is no longer available/
  )
  await assert.rejects(
    () => acceptTrip(supabase, storedTrip, 'driver-3'),
    /That ride is no longer available/
  )

  // Ensure no accept event was logged
  const acceptEvents = supabase._tables.trip_events.filter(
    (e) => e.trip_id === trip.id && e.kind === 'accepted',
  )
  assert.equal(acceptEvents.length, 0, 'No accept event should be logged after cancellation')
})

test('R001: canceled event payload contains correct information', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario({
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.68, lng: -82.84 },
    ],
  })

  const cancelTime = '2026-10-01T08:05:00.000Z'
  await cancelSearchingTrip(supabase, trip.id, trip.rider_id, cancelTime)

  const cancelEvent = supabase._tables.trip_events.find(
    (e) => e.trip_id === trip.id && e.kind === 'canceled'
  )
  assert.ok(cancelEvent, 'Canceled event should exist')
  assert.equal(cancelEvent.payload.reason, 'rider_cancel')
  assert.equal(cancelEvent.payload.source, 'rider_app')
  assert.equal(cancelEvent.payload.canceled_at, cancelTime)
})

test('R001: trip canceled_at is set correctly', async () => {
  const { supabase, trip } = seedMatchingScenario({
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.68, lng: -82.84 },
    ],
  })

  const cancelTime = '2026-10-01T08:05:00.000Z'
  await cancelSearchingTrip(supabase, trip.id, trip.rider_id, cancelTime)

  const storedTrip = supabase._tables.trips.find((t) => t.id === trip.id)
  assert.equal(storedTrip.canceled_at, cancelTime)
})
