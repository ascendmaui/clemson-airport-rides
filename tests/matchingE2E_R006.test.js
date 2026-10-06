import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadDriverDesk,
  acceptTrip,
} from '../packages/rides-native/driverDesk.js'
import {
  seedMatchingScenario,
} from './fixtures/matchingE2E.js'

test('driver desk correctly handles scheduled trips', async () => {
  const { supabase, trip: scheduledTrip, drivers } = seedMatchingScenario({
    tripId: 'trip-scheduled-1',
    riderId: 'rider-1',
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.6801, lng: -82.8412 },
      { id: 'driver-2', approved: true, online: true, lat: 34.6812, lng: -82.8401 },
    ],
    trip: {
      status: 'scheduled',
      // We need to set a pickup_at time in the future for it to be considered scheduled
      pickup_at: '2026-10-01T09:00:00.000Z', // one hour from the requested_at in the seed
    },
  })

  const driverId = drivers[0].id
  const driver2Id = drivers[1].id

  // Mock the rpc method for accept_scheduled_trip
  const originalRpc = supabase.rpc
  supabase.rpc = async (fn, params) => {
    if (fn === 'accept_scheduled_trip') {
      console.log("mock rpc called with:", fn, params);
      // Simulate accepting the trip
      const { data, error } = await supabase
        .from('trips')
        .update({ status: 'accepted', driver_id: driverId })
        .eq('id', params.p_trip_id)
        .in('status', ['scheduled'])
        .select('id, status, driver_id, accepted_at')
        .maybeSingle()
      console.log("mock update result:", data, error);
      if (error) throw error
      const result = Array.isArray(data) ? data[0] : data;
      console.log("mock returning:", result);
    return { data: result, error: null };
    }
    // If there's an original rpc, call it
    if (originalRpc) {
      return originalRpc.call(supabase, fn, params)
    }
    throw new Error(`Unknown RPC: ${fn}`)
  }
  // Initially, the scheduled trip should appear in scheduledOpen
  let desk = await loadDriverDesk(supabase, driverId)
  assert.equal(desk.scheduledOpen.length, 1)
  assert.equal(desk.scheduledOpen[0].id, scheduledTrip.id)
  assert.equal(desk.scheduledOpen[0].status, 'scheduled')

  // Multiple drivers should be able to see the same scheduled trip
  let desk2 = await loadDriverDesk(supabase, driver2Id)
  assert.equal(desk2.scheduledOpen.length, 1)
  assert.equal(desk2.scheduledOpen[0].id, scheduledTrip.id)

  // Driver 1 accepts the scheduled trip
  const accepted = await acceptTrip(supabase, desk.scheduledOpen[0], driverId)
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.driver_id, driverId)

  // After accepting, the scheduled trip should move from scheduledOpen to active
  desk = await loadDriverDesk(supabase, driverId)
  console.log("desk after accept:", JSON.stringify(desk, null, 2));
  assert.equal(desk.scheduledOpen.length, 0) // no longer in scheduledOpen
  assert.notEqual(desk.active, null)
  assert.equal(desk.active.id, scheduledTrip.id)
  assert.equal(desk.active.status, 'accepted')

  // Driver 2 should no longer see the trip in scheduledOpen (because it's accepted)
  desk2 = await loadDriverDesk(supabase, driver2Id)
  assert.equal(desk2.scheduledOpen.length, 0)

  // Verify that the trip is now accepted in the database
  const acceptedTrip = supabase._tables.trips.find(t => t.id === scheduledTrip.id)
  assert.equal(acceptedTrip.status, 'accepted')
  assert.equal(acceptedTrip.driver_id, driverId)

  // Verify that an accepted event was written
  const acceptedEvents = supabase._tables.trip_events.filter(
    (event) => event.trip_id === scheduledTrip.id && event.kind === 'accepted'
  )
  assert.equal(acceptedEvents.length, 1)
  assert.equal(acceptedEvents[0].payload.driver_id, driverId)

  // Restore the original rpc
  supabase.rpc = originalRpc
})

test('scheduled trip that is expired is removed from scheduledOpen', async () => {
  const { supabase, trip: scheduledTrip, drivers } = seedMatchingScenario({
    tripId: 'trip-scheduled-1',
    riderId: 'rider-1',
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.6801, lng: -82.8412 },
    ],
    trip: {
      status: 'scheduled',
      pickup_at: '2026-10-01T09:00:00.000Z', // future relative to requested_at but we will expire it
    },
  })

  const driverId = drivers[0].id

  // First, verify that the trip is in scheduledOpen (not expired yet)
  let desk = await loadDriverDesk(supabase, driverId)
  assert.equal(desk.scheduledOpen.length, 1)

  // Now, expire the trip by updating its status to canceled (as if the pickup_at has passed)
  const { data: updatedTrip, error: updateError } = await supabase
    .from('trips')
    .update({ status: 'canceled', canceled_at: '2026-10-01T09:30:00.000Z' })
    .eq('id', scheduledTrip.id)
    .eq('status', 'scheduled')
    .maybeSingle()
  assert.equal(updateError, null)
  assert.equal(updatedTrip.status, 'canceled')
  assert.equal(updatedTrip.canceled_at, '2026-10-01T09:30:00.000Z')

  // Verify that the trip is now canceled in the _tables
  const expiredTrip = supabase._tables.trips.find(t => t.id === scheduledTrip.id)
  assert.equal(expiredTrip.status, 'canceled')
  assert.equal(expiredTrip.canceled_at, '2026-10-01T09:30:00.000Z')

  // Now, load the driver desk and verify that the trip is no longer in scheduledOpen
  desk = await loadDriverDesk(supabase, driverId)
  assert.equal(desk.scheduledOpen.length, 0)
})
