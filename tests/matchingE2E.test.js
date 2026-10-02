import assert from 'node:assert/strict'
import test from 'node:test'
import { acceptTrip, loadDriverDesk } from '../packages/rides-native/driverDesk.js'
import { etaLineFor, riderLiveView, showSearchTheater } from '../packages/rides-native/liveTrip.js'
import {
  cancelSearchingTrip,
  riderTrackingSnapshot,
  seedMatchingScenario,
} from './fixtures/matchingE2E.js'

test('searching trip crosses driver offer, accept, event, and rider En route tracking seam', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario()
  const driverId = drivers[0].id

  const desk = await loadDriverDesk(supabase, driverId)
  assert.deepEqual(desk.offers.map((offer) => offer.id), [trip.id])

  const accepted = await acceptTrip(supabase, desk.offers[0], driverId)
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.driver_id, driverId)
  assert.match(accepted.accepted_at, /^\d{4}-\d{2}-\d{2}T/)

  const events = supabase._tables.trip_events.filter((event) => event.trip_id === trip.id)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'accepted')
  assert.equal(events[0].payload.driver_id, driverId)

  const riderTrip = riderTrackingSnapshot(supabase, trip.id)
  const view = riderLiveView(riderTrip.status)
  assert.equal(view.kicker, 'EN ROUTE')
  assert.equal(view.steps[view.stepIndex].label, 'En route')
  assert.equal(showSearchTheater(riderTrip.status), false)
  assert.equal(riderTrip.driver_id, driverId)
  assert.equal(riderTrip.driverName, `Fixture ${driverId}`)
  assert.match(
    etaLineFor(
      riderTrip.status,
      { lat: riderTrip.driverLat, lng: riderTrip.driverLng },
      riderTrip,
    ),
    /to pickup$/,
  )
})

test('two approved online drivers racing the same trip produce one winner and one event', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario()
  const results = await Promise.allSettled(
    drivers.map((driver) => acceptTrip(supabase, trip, driver.id)),
  )

  const winners = results.filter((result) => result.status === 'fulfilled')
  const losers = results.filter((result) => result.status === 'rejected')
  assert.equal(winners.length, 1)
  assert.equal(losers.length, 1)
  assert.match(losers[0].reason.message, /no longer available/)

  const acceptedTrip = supabase._tables.trips.find((row) => row.id === trip.id)
  assert.equal(acceptedTrip.status, 'accepted')
  assert.ok(drivers.some((driver) => driver.id === acceptedTrip.driver_id))
  assert.equal(supabase._tables.trip_events.filter((event) => event.kind === 'accepted').length, 1)
})

test('offline and unapproved drivers cannot accept an open-pool trip', async () => {
  const { supabase, trip } = seedMatchingScenario({
    drivers: [
      { id: 'driver-offline', approved: true, online: false, lat: 34.68, lng: -82.84 },
      { id: 'driver-unapproved', approved: false, online: true, lat: 34.68, lng: -82.84 },
    ],
  })

  await assert.rejects(
    () => acceptTrip(supabase, trip, 'driver-offline'),
    /Go online before accepting a ride/,
  )
  await assert.rejects(
    () => acceptTrip(supabase, trip, 'driver-unapproved'),
    /Finish approval to go online/,
  )
  assert.equal(supabase._tables.trips[0].status, 'searching')
  assert.equal(supabase._tables.trips[0].driver_id, null)
  assert.equal(supabase._tables.trip_events.length, 0)
})

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
