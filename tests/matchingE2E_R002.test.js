import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptTrip,
  loadDriverDesk,
} from '../packages/rides-native/driverDesk.js'
import {
  seedMatchingScenario,
} from './fixtures/matchingE2E.js'

test('R002: rider cancels accepted trip; driver accept is rolled back and trip is canceled', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario()
  const driverId = drivers[0].id

  // Driver accepts the trip
  const desk = await loadDriverDesk(supabase, driverId)
  assert.deepEqual(desk.offers.map((offer) => offer.id), [trip.id])

  const accepted = await acceptTrip(supabase, desk.offers[0], driverId)
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.driver_id, driverId)
  assert.match(accepted.accepted_at, /^\d{4}-\d{2}-\d{2}T/)

  // Verify accept event was logged
  const acceptEvents = supabase._tables.trip_events.filter((event) => event.trip_id === trip.id && event.kind === 'accepted')
  assert.equal(acceptEvents.length, 1)
  assert.equal(acceptEvents[0].payload.driver_id, driverId)

  // Rider cancels the accepted trip
  // We simulate by updating the trip to canceled and inserting a canceled event
  const canceledAt = '2026-10-01T08:10:00.000Z'
  const { data: updatedTrip, error: updateError } = await supabase
    .from('trips')
    .update({ status: 'canceled', driver_id: null, canceled_at: canceledAt })
    .eq('id', trip.id)
    .eq('rider_id', trip.rider_id)
    .in('status', ['accepted']) // only allow cancel from accepted status
    .select()
    .maybeSingle()
  assert.equal(updateError, null)
  assert.equal(updatedTrip.status, 'canceled')
  assert.equal(updatedTrip.driver_id, null)
  assert.equal(updatedTrip.canceled_at, canceledAt)

  // Insert the canceled event
  const { data: eventData, error: eventError } = await supabase
    .from('trip_events')
    .insert({
      trip_id: trip.id,
      kind: 'canceled',
      payload: { reason: 'rider_cancel', source: 'rider_app', canceled_at: canceledAt },
    })
  assert.equal(eventError, null)
  assert.equal(eventData.length, 1)

  // Verify trip is now canceled
  const storedTrip = supabase._tables.trips.find((t) => t.id === trip.id)
  assert.equal(storedTrip.status, 'canceled')
  assert.equal(storedTrip.driver_id, null)
  assert.equal(storedTrip.canceled_at, canceledAt)

  // Verify that the accept event is still present (we keep the log) and a canceled event is added
  const acceptEventsAfter = supabase._tables.trip_events.filter((event) => event.trip_id === trip.id && event.kind === 'accepted')
  const canceledEvents = supabase._tables.trip_events.filter((event) => event.trip_id === trip.id && event.kind === 'canceled')
  assert.equal(acceptEventsAfter.length, 1, 'Accept event remains in the log')
  assert.equal(canceledEvents.length, 1, 'One canceled event logged')
  assert.equal(canceledEvents[0].payload.reason, 'rider_cancel')
  assert.equal(canceledEvents[0].payload.source, 'rider_app')

  // Ensure driver cannot accept the trip again (since it's canceled)
  await assert.rejects(
    () => acceptTrip(supabase, storedTrip, driverId),
    /That ride is no longer available/
  )
})
