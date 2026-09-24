import assert from 'node:assert/strict'
import test from 'node:test'
import { OPEN_POOL_COPY, PREFERRED_CANCELED_COPY, PREFERRED_MATCH_COPY } from './drivers.js'
import { acceptActionLabel, declineActionLabel, driverStatusDetail } from './tripTags.js'
import { acceptNeedsDriverOnline } from './tripTags.js'
import {
  DRIVER_TRACK_STEPS,
  SEARCH_PREVIEW_COPY,
  STILL_SEARCHING_COPY,
  STILL_SEARCHING_MS,
  STRAIGHT_LINE_WAIT,
  checkoutSuccessHash,
  etaHoldLine,
  etaLineFor,
  riderLiveStepIndex,
  riderLiveSteps,
  orderedLiveStops,
  riderLiveView,
  showSearchTheater,
  straightLineEta,
} from './liveTrip.js'

test('rider live states run searching, offered or requested, en route, arrived, in trip, completed', () => {
  assert.deepEqual(
    riderLiveSteps('offered').map((step) => step.label),
    ['Searching', 'Offered', 'En route', 'Arrived', 'In trip', 'Done'],
  )
  assert.equal(riderLiveSteps('requested')[1].label, 'Requested')
  assert.equal(riderLiveStepIndex('searching'), 0)
  assert.equal(riderLiveStepIndex('offered'), 1)
  assert.equal(riderLiveStepIndex('requested'), 1)
  assert.equal(riderLiveStepIndex('accepted'), 2)
  assert.equal(riderLiveStepIndex('arriving'), 2)
  assert.equal(riderLiveStepIndex('arrived'), 3)
  assert.equal(riderLiveStepIndex('in_progress'), 4)
  assert.equal(riderLiveStepIndex('completed'), 5)
  assert.equal(riderLiveStepIndex('canceled'), -1)
})

test('preferred matching copy cancels instead of falling back to the open pool', () => {
  const waiting = riderLiveView('requested', { preferred: true })
  assert.equal(waiting.title, 'Waiting on your driver')
  assert.equal(waiting.body, PREFERRED_MATCH_COPY)
  assert.match(waiting.body, /does not auto-match/)
  const canceled = riderLiveView('canceled', { preferred: true })
  assert.equal(canceled.body, PREFERRED_CANCELED_COPY)
  assert.equal(riderLiveView('searching').body, OPEN_POOL_COPY)
  assert.equal(riderLiveView('offered').kicker, 'OFFERED')
  assert.equal(riderLiveView('arriving').kicker, 'EN ROUTE')
  assert.equal(riderLiveView('in_progress').title, 'You are on the way')
  assert.equal(riderLiveView('completed').kicker, 'COMPLETED')
})

test('straight-line ETA uses existing coordinates and names the pickup or drop-off', () => {
  const from = { lat: 34.6788, lng: -82.843 }
  const pickup = { lat: 34.6836, lng: -82.8364 }
  const line = etaLineFor('accepted', from, { pickupLat: pickup.lat, pickupLng: pickup.lng })
  assert.match(line, /straight line to pickup/)
  assert.equal(etaLineFor('searching', from, { pickupLat: pickup.lat, pickupLng: pickup.lng }), null)
  assert.match(
    etaLineFor('in_progress', from, { dropoffLat: 34.8957, dropoffLng: -82.2189 }),
    /to drop-off/,
  )
  assert.equal(straightLineEta(null, pickup).label, null)
})

test('driver accept and decline labels keep preferred cancel semantics', () => {
  assert.equal(acceptActionLabel('requested'), 'Accept preferred ride')
  assert.equal(acceptActionLabel('searching'), 'Accept')
  assert.equal(declineActionLabel('requested'), 'Decline and cancel')
  assert.equal(declineActionLabel('offered'), 'Decline')
  assert.equal(declineActionLabel('searching'), 'Decline')
  assert.equal(declineActionLabel('scheduled'), 'Not this one')
  assert.match(driverStatusDetail('requested'), /does not return to the open pool/)
  assert.match(driverStatusDetail('offered'), /open pool/)
  assert.equal(DRIVER_TRACK_STEPS.map((step) => step.id).join(','), 'accepted,arriving,arrived,in_progress,completed')
})

test('searching stays honest and an accept opens track without a Maps key', () => {
  assert.equal(riderLiveView('searching', { waitingMs: STILL_SEARCHING_MS }).body, STILL_SEARCHING_COPY)
  assert.equal(showSearchTheater('searching'), true)
  assert.equal(showSearchTheater('accepted'), false)
  assert.match(SEARCH_PREVIEW_COPY, /preview/)
  assert.equal(etaHoldLine('accepted', null), STRAIGHT_LINE_WAIT)
  assert.match(etaHoldLine('in_progress', 'About 4 min · 1.2 mi straight line to drop-off'), /drop-off/)
  assert.equal(etaHoldLine('searching', null), null)
  assert.equal(checkoutSuccessHash({ tripId: 'abc', scheduled: false }), '#/requested?trip=abc&paid=1')
  assert.equal(checkoutSuccessHash({ tripId: 'abc', scheduled: true }), '#/schedule?paid=1&trip=abc')
  assert.equal(acceptNeedsDriverOnline('searching'), true)
  assert.equal(acceptNeedsDriverOnline('requested'), true)
  assert.equal(acceptNeedsDriverOnline('scheduled'), false)
})

test('ordered live stops follow stop order and fall back to empty', () => {
  assert.deepEqual(orderedLiveStops(null), [])
  assert.deepEqual(orderedLiveStops({}), [])
  assert.deepEqual(orderedLiveStops({ stops: [], pickup_lat: 34.68, pickup_lng: -82.84 }), [])
  const friend = orderedLiveStops({
    kind: 'friend_ride',
    status: 'booked',
    stops: [
      { lat: 34.69, lng: -82.85, label: 'Library', order: 2, kind: 'dropoff' },
      { lat: 34.67881, lng: -82.84319, label: 'Stadium', order: 0, kind: 'pickup' },
      { label: 'missing coords', order: 1 },
      { lat: 34.6834, lng: -82.8374, label: 'Downtown', order: 1, kind: 'pickup' },
    ],
  })
  assert.deepEqual(friend.map((stop) => stop.title), ['1 · Stadium', '2 · Downtown', '3 · Library'])
  assert.equal(friend[0].lat, 34.67881)
  assert.equal(friend[0].approximate, false)
  assert.equal(friend[0].kind, 'pickup')
  assert.equal(friend[2].kind, 'dropoff')
  const fromMeta = orderedLiveStops({
    stops: [],
    metadata: { stops: [{ lat: 34.67, lng: -82.83, label: 'A' }, { lat: 34.7, lng: -82.9, name: 'B' }] },
  })
  assert.deepEqual(fromMeta.map((stop) => stop.label), ['A', 'B'])
  const fromRide = orderedLiveStops({
    friend_ride: { stops: [{ latitude: 34.1, longitude: -82.1, address: 'Tillman' }] },
  })
  assert.equal(fromRide[0].title, '1 · Tillman')
  assert.equal(orderedLiveStops({
    stops: [{ lat: 1, lng: 2, label: 'Trip' }],
    metadata: { stops: [{ lat: 9, lng: 9, label: 'Meta' }] },
  })[0].label, 'Trip')
})

test('booked carpool public pins round to 3 decimals and still return without a polyline', () => {
  const booked = orderedLiveStops({
    status: 'booked',
    kind: 'carpool',
    route_polyline: null,
    stops: [
      { lat: 34.67881, lng: -82.84319, label: 'Home', order: 0 },
      { lat: 34.89574, lng: -82.21891, label: 'GSP', order: 1 },
    ],
  })
  assert.equal(booked[0].lat, 34.679)
  assert.equal(booked[0].lng, -82.843)
  assert.equal(booked[1].lat, 34.896)
  assert.equal(booked[1].lng, -82.219)
  assert.equal(booked[0].approximate, true)
  const trip = orderedLiveStops({
    status: 'accepted',
    metadata: { kind: 'carpool', friend_ride_id: 'ride-1', route_polyline: null },
    stops: [{ lat: 34.67881, lng: -82.84319, label: 'A' }, { lat: 34.89574, lng: -82.21891, label: 'B' }],
  })
  assert.equal(trip[0].approximate, true)
  assert.equal(trip[0].lat, 34.679)
  const exact = orderedLiveStops({
    status: 'accepted',
    metadata: { kind: 'carpool', friend_ride_id: 'ride-1' },
    stops: [{ lat: 34.67881, lng: -82.84319, label: 'A' }],
  }, { approximate: false })
  assert.equal(exact[0].lat, 34.67881)
  assert.equal(exact[0].approximate, false)
  const lobby = orderedLiveStops({
    kind: 'carpool',
    status: 'collecting',
    stops: [{ lat: 34.67881, lng: -82.84319, label: 'Lobby' }],
  })
  assert.equal(lobby[0].lat, 34.67881)
  assert.equal(lobby[0].approximate, false)
})
