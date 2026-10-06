import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptTrip,
  loadDriverDesk,
  publishDriverLocation,
} from '../packages/rides-native/driverDesk.js'
import { etaLineFor, riderLiveView, showSearchTheater } from '../packages/rides-native/liveTrip.js'
import {
  cancelSearchingTrip,
  expireSearchingTrip,
  requestDriverTrip,
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


test('driver going offline during an offer window cannot accept the stale offer', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario()
  const driverId = drivers[0].id
  const firstDesk = await loadDriverDesk(supabase, driverId)
  const offered = firstDesk.offers[0]
  assert.equal(firstDesk.online, true)
  assert.equal(offered.id, trip.id)

  await publishDriverLocation(supabase, driverId, {
    lat: drivers[0].lat,
    lng: drivers[0].lng,
    online: false,
  })
  const offlineDesk = await loadDriverDesk(supabase, driverId)
  assert.equal(offlineDesk.online, false)

  await assert.rejects(
    () => acceptTrip(supabase, offered, driverId),
    /Go online before accepting a ride/,
  )
  assert.equal(supabase._tables.trips[0].status, 'searching')
  assert.equal(supabase._tables.trips[0].driver_id, null)
  assert.equal(supabase._tables.trip_events.length, 0)
})

test('search TTL expiry closes the trip and rejects a late accept', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario()
  const driverId = drivers[0].id
  const offered = (await loadDriverDesk(supabase, driverId)).offers[0]
  assert.equal(offered.id, trip.id)

  const expired = await expireSearchingTrip(supabase, trip.id, {
    expiredBefore: '2026-10-01T08:10:00.000Z',
  })
  assert.equal(expired.status, 'canceled')
  assert.equal(expired.driver_id, null)
  assert.equal(expired.canceled_at, '2026-10-01T08:15:00.000Z')
  assert.deepEqual((await loadDriverDesk(supabase, driverId)).offers, [])

  await assert.rejects(
    () => acceptTrip(supabase, offered, driverId),
    /no longer available/,
  )
  const events = supabase._tables.trip_events.filter((event) => event.trip_id === trip.id)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'canceled')
  assert.equal(events[0].payload.reason, 'search_ttl_expired')
})

test('rider can cancel and re-request as an independent matching attempt', async () => {
  const { supabase, trip, riderId, drivers } = seedMatchingScenario()
  const driverId = drivers[0].id

  await cancelSearchingTrip(supabase, trip.id, riderId)
  const nextTrip = await requestDriverTrip(supabase, {
    id: 'trip-searching-2',
    riderId,
    dropoffLabel: 'Downtown Clemson',
  })
  assert.notEqual(nextTrip.id, trip.id)
  assert.equal(nextTrip.status, 'searching')

  const desk = await loadDriverDesk(supabase, driverId)
  assert.deepEqual(desk.offers.map((offer) => offer.id), [nextTrip.id])
  const accepted = await acceptTrip(supabase, desk.offers[0], driverId)
  assert.equal(accepted.id, nextTrip.id)
  assert.equal(accepted.status, 'accepted')

  const firstAttempt = supabase._tables.trips.find((row) => row.id === trip.id)
  const secondAttempt = supabase._tables.trips.find((row) => row.id === nextTrip.id)
  assert.equal(firstAttempt.status, 'canceled')
  assert.equal(firstAttempt.driver_id, null)
  assert.equal(secondAttempt.status, 'accepted')
  assert.equal(secondAttempt.driver_id, driverId)
  assert.deepEqual(
    supabase._tables.trip_events.map((event) => [event.trip_id, event.kind]),
    [
      [trip.id, 'canceled'],
      [nextTrip.id, 'searching'],
      [nextTrip.id, 'accepted'],
    ],
  )
})

test('same driver double-submit accepts once and writes one accepted event', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario()
  const driverId = drivers[0].id

  const results = await Promise.allSettled([
    acceptTrip(supabase, trip, driverId),
    acceptTrip(supabase, trip, driverId),
  ])
  const fulfilled = results.filter((result) => result.status === 'fulfilled')
  const rejected = results.filter((result) => result.status === 'rejected')
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.match(rejected[0].reason.message, /no longer available/)

  const stored = supabase._tables.trips.find((row) => row.id === trip.id)
  assert.equal(stored.status, 'accepted')
  assert.equal(stored.driver_id, driverId)
  const acceptedEvents = supabase._tables.trip_events.filter(
    (event) => event.trip_id === trip.id && event.kind === 'accepted',
  )
  assert.equal(acceptedEvents.length, 1)
  assert.equal(acceptedEvents[0].payload.driver_id, driverId)
})

test('concurrent driver accept vs rider cancel produces exactly one winner and consistent event stream', async () => {
  const { supabase, trip, riderId, drivers } = seedMatchingScenario()
  const driverId = drivers[0].id

  const results = await Promise.allSettled([
    acceptTrip(supabase, trip, driverId),
    cancelSearchingTrip(supabase, trip.id, riderId),
  ])
  const fulfilled = results.filter((result) => result.status === 'fulfilled')
  const rejected = results.filter((result) => result.status === 'rejected')
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)

  const stored = supabase._tables.trips.find((row) => row.id === trip.id)
  const acceptedEvents = supabase._tables.trip_events.filter(
    (event) => event.trip_id === trip.id && event.kind === 'accepted',
  )
  const canceledEvents = supabase._tables.trip_events.filter(
    (event) => event.trip_id === trip.id && event.kind === 'canceled',
  )

  if (fulfilled[0].value.status === 'accepted') {
    assert.equal(stored.status, 'accepted')
    assert.equal(stored.driver_id, driverId)
    assert.equal(acceptedEvents.length, 1)
    assert.equal(canceledEvents.length, 0)
    assert.match(rejected[0].reason.message, /no longer searching/)
  } else {
    assert.equal(stored.status, 'canceled')
    assert.equal(stored.driver_id, null)
    assert.equal(acceptedEvents.length, 0)
    assert.equal(canceledEvents.length, 1)
    assert.match(rejected[0].reason.message, /no longer available/)
  }
})

test('concurrent driver accept vs search TTL expiry produces exactly one winner without split state', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario()
  const driverId = drivers[0].id

  const results = await Promise.allSettled([
    acceptTrip(supabase, trip, driverId),
    expireSearchingTrip(supabase, trip.id, { expiredBefore: '2026-10-01T08:10:00.000Z' }),
  ])
  const fulfilled = results.filter((result) => result.status === 'fulfilled')
  const rejected = results.filter((result) => result.status === 'rejected')
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)

  const stored = supabase._tables.trips.find((row) => row.id === trip.id)
  const acceptedEvents = supabase._tables.trip_events.filter((e) => e.kind === 'accepted')
  const canceledEvents = supabase._tables.trip_events.filter((e) => e.kind === 'canceled')

  if (fulfilled[0].value.status === 'accepted') {
    assert.equal(stored.status, 'accepted')
    assert.equal(stored.driver_id, driverId)
    assert.equal(acceptedEvents.length, 1)
    assert.equal(canceledEvents.length, 0)
  } else {
    assert.equal(stored.status, 'canceled')
    assert.equal(stored.driver_id, null)
    assert.equal(acceptedEvents.length, 0)
    assert.equal(canceledEvents.length, 1)
  }
})

test('targeted ride request cannot be hijacked by an unassigned driver', async () => {
  const { supabase } = seedMatchingScenario({
    trip: {
      status: 'requested',
      driver_id: 'driver-1',
    },
  })

  // Driver 2 tries to accept a trip targeted at driver 1
  await assert.rejects(
    () => acceptTrip(supabase, { id: 'trip-searching-1', status: 'requested' }, 'driver-2'),
    /That ride is no longer available/,
  )

  const stored = supabase._tables.trips.find((row) => row.id === 'trip-searching-1')
  assert.equal(stored.status, 'requested')
  assert.equal(stored.driver_id, 'driver-1')
  assert.equal(supabase._tables.trip_events.length, 0)
})

test('terminal trip statuses reject late accept without inserting events', async () => {
  for (const status of ['in_progress', 'arrived', 'completed', 'canceled']) {
    const { supabase } = seedMatchingScenario({
      trip: { status, driver_id: 'driver-1' },
    })

    await assert.rejects(
      () => acceptTrip(supabase, { id: 'trip-searching-1', status }, 'driver-2'),
      /That ride is no longer available/,
    )
    assert.equal(supabase._tables.trip_events.length, 0)
  }
})


test('targeted offers fan out only to their target while open offers reach both drivers', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario()
  // More hidden requests than the desk page size must not crowd out an eligible offer.
  supabase._tables.trips.unshift(...Array.from({ length: 25 }, (_, index) => ({
    ...trip, id: `targeted-${index}`, requested_at: '2026-10-02T00:00:00.000Z',
    metadata: { offer_driver_id: drivers[0].id },
  })))
  const desk = await loadDriverDesk(supabase, drivers[1].id)
  assert.deepEqual(desk.offers.map((row) => row.id), [trip.id])
  await assert.rejects(
    acceptTrip(supabase, { id: 'targeted-0' }, drivers[1].id), /no longer available/,
  )
  assert.equal(supabase._tables.trip_events.length, 0)
  const first = await loadDriverDesk(supabase, drivers[0].id)
  assert.equal(first.offers.length, 20)
})

test('a reassigned target between read and claim rejects the stale accept', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario({
    trip: { metadata: { offer_driver_id: 'driver-1' } },
  })
  const originalFrom = supabase.from
  supabase.from = (table) => {
    if (table === 'driver_status') {
      supabase._tables.trips[0].metadata = { offer_driver_id: drivers[1].id }
    }
    return originalFrom(table)
  }
  await assert.rejects(acceptTrip(supabase, trip, drivers[0].id), /no longer available/)
  assert.equal(supabase._tables.trips[0].driver_id, null)
  assert.equal(supabase._tables.trip_events.length, 0)
})

test('an absent trip cannot be claimed using a stale card', async () => {
  const { supabase, trip, drivers } = seedMatchingScenario()
  supabase._tables.trips.length = 0
  await assert.rejects(acceptTrip(supabase, trip, drivers[0].id), /no longer available/)
  assert.equal(supabase._tables.trip_events.length, 0)
})
