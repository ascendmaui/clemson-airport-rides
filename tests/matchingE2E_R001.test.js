import assert from 'node:assert/strict'
import test from 'node:test'
import { loadDriverDesk, acceptTrip } from '../packages/rides-native/driverDesk.js'
import { cancelSearchingTrip, seedMatchingScenario } from './fixtures/matchingE2E.js'

test('rider cancel removes a searching offer and rejects a stale driver accept', async () => {
  const { supabase, trip, riderId, drivers } = seedMatchingScenario()
  const driverId = drivers[0].id
  const offered = (await loadDriverDesk(supabase, driverId)).offers[0]
  assert.equal(offered.id, trip.id)

  const canceled = await cancelSearchingTrip(supabase, trip.id, riderId)
  assert.equal(canceled.status, 'canceled')
  assert.equal(canceled.driver_id, null)
  assert.match(canceled.canceled_at, /^2026-10-01T08:05:00/)

  const refreshed = await loadDriverDesk(supabase, driverId)
  assert.deepEqual(refreshed.offers, [])
  await assert.rejects(
    () => acceptTrip(supabase, offered, driverId),
    /no longer available/,
  )

  const acceptedEvents = supabase._tables.trip_events.filter((event) => event.kind === 'accepted')
  const canceledEvents = supabase._tables.trip_events.filter((event) => event.kind === 'canceled')
  assert.equal(acceptedEvents.length, 0)
  assert.equal(canceledEvents.length, 1)
  assert.equal(canceledEvents[0].payload.reason, 'rider_cancel')
})
