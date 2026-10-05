import assert from 'node:assert/strict'
import test from 'node:test'
import { OPEN_POOL_COPY, PREFERRED_CANCELED_COPY, PREFERRED_MATCH_COPY } from './drivers.js'
import { acceptActionLabel, declineActionLabel, driverStatusDetail } from './tripTags.js'
import { acceptNeedsDriverOnline } from './tripTags.js'
import {
  DRIVER_TRACK_STEPS,
  SEARCH_APPROX_WAIT_NOTE,
  RIDER_SEARCH_MOTION_COPY,
  SEARCH_PREVIEW_COPY,
  STILL_SEARCHING_COPY,
  STILL_SEARCHING_MS,
  STRAIGHT_LINE_WAIT,
  checkoutSuccessHash,
  activeTripRouteLine,
  decodeRoutePolyline,
  etaHoldLine,
  liveDriverTitle,
  etaLineFor,
  mapRouteCoordinates,
  riderLiveStepIndex,
  roadEtaLine,
  riderLiveSteps,
  orderedLiveStops,
  riderLiveView,
  searchingApproxWaitLine,
  searchingEtaLine,
  searchingRidePreview,
  searchingRouteLine,
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
  assert.equal(riderLiveView('arriving').kicker, 'ARRIVING')
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
  assert.equal(roadEtaLine(600, 'drop-off'), 'About 10 min by road to drop-off')
  assert.match(
    etaLineFor('in_progress', from, {
      dropoffLat: 34.8957,
      dropoffLng: -82.2189,
      routeDurationS: 600,
    }),
    /straight line to drop-off/,
  )
  const decoded = decodeRoutePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
  assert.equal(decoded.length, 3)
  assert.ok(Math.abs(decoded[0].lat - 38.5) < 0.001)
  assert.ok(Math.abs(decoded[0].lng - -120.2) < 0.001)
  assert.equal(mapRouteCoordinates('').length, 0)
  assert.equal(decodeRoutePolyline(null).length, 0)
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
  assert.match(RIDER_SEARCH_MOTION_COPY, /This ride moves forward only when a real driver accepts/)
  assert.doesNotMatch(RIDER_SEARCH_MOTION_COPY, /driver accept moves/)
  assert.match(RIDER_SEARCH_MOTION_COPY, /preview/)
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


test('active trip draws a route line without a stored polyline and keeps the straight-line ETA', () => {
  const trip = {
    status: 'in_progress',
    pickup_lat: 34.6788,
    pickup_lng: -82.843,
    dropoff_lat: 34.8957,
    dropoff_lng: -82.2189,
    metadata: {},
  }
  const driver = { lat: 34.7, lng: -82.8 }
  const line = activeTripRouteLine(trip, driver)
  assert.equal(line.length, 2)
  assert.deepEqual(line[0], [34.7, -82.8])
  assert.deepEqual(line[1], [34.8957, -82.2189])
  assert.match(etaLineFor('in_progress', driver, trip), /to drop-off/)
  const waiting = activeTripRouteLine({ ...trip, status: 'searching' }, null)
  assert.deepEqual(waiting, [[34.6788, -82.843], [34.8957, -82.2189]])
  const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
  const road = activeTripRouteLine({ ...trip, metadata: { route_polyline: encoded } }, driver)
  assert.equal(road.length, 3)
  assert.ok(Math.abs(road[0][0] - 38.5) < 0.001)
  assert.deepEqual(activeTripRouteLine(null, driver), [])
  const stops = activeTripRouteLine({
    status: 'accepted',
    stops: [
      { lat: 34.6788, lng: -82.843, label: 'Stadium', order: 0 },
      { lat: 34.6836, lng: -82.8364, label: 'Downtown', order: 1 },
    ],
  }, null)
  assert.equal(stops.length, 2)
  assert.deepEqual(stops[0], [34.6788, -82.843])
})

test('searching preview draws the stored road or a straight pickup to drop-off and labels the wait as approximate', () => {
  const trip = {
    status: 'searching',
    pickup_lat: 34.6788,
    pickup_lng: -82.843,
    dropoff_lat: 34.8957,
    dropoff_lng: -82.2189,
    metadata: {},
    driver_lat: 34.7,
    driver_lng: -82.8,
    stops: [
      { lat: 34.6788, lng: -82.843, label: 'Stadium' },
      { lat: 34.7, lng: -82.8, label: 'Downtown' },
    ],
  }
  assert.deepEqual(searchingRouteLine(trip), [[34.6788, -82.843], [34.8957, -82.2189]])
  const minutes = straightLineEta(
    { lat: trip.pickup_lat, lng: trip.pickup_lng },
    { lat: trip.dropoff_lat, lng: trip.dropoff_lng },
  ).etaMin
  assert.ok(minutes >= 1)
  assert.match(searchingEtaLine(trip), /straight line to drop-off/)
  assert.equal(searchingApproxWaitLine(trip), `Approximate wait · about ${minutes} min`)
  assert.doesNotMatch(searchingApproxWaitLine(trip), /driver|arriv|on the way/i)
  assert.match(SEARCH_APPROX_WAIT_NOTE, /not a live arrival/i)
  assert.equal(etaLineFor('searching', { lat: 34.7, lng: -82.8 }, trip), null)

  const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
  const preview = searchingRidePreview({
    ...trip,
    metadata: { route_polyline: encoded, route_duration_s: 600 },
  })
  assert.equal(preview.route.length, 3)
  assert.ok(Math.abs(preview.route[0][0] - 38.5) < 0.001)
  assert.equal(preview.eta, 'About 10 min by road to drop-off')
  assert.equal(preview.wait, 'Approximate wait · about 10 min')
  assert.deepEqual(searchingRouteLine(null), [])
  assert.equal(searchingEtaLine({ status: 'searching' }), null)
  assert.equal(searchingApproxWaitLine({ status: 'searching' }), 'Approximate wait')
  assert.match(searchingApproxWaitLine({ ...trip, metadata: { route_duration_s: 90 } }), /about 2 min/)
})

test('pickup ETA follows current GPS and confirmed arrival replaces countdown', () => {
  const places = { pickup_lat: 34.68, pickup_lng: -82.83, dropoff_lat: 34.9, dropoff_lng: -82.9 }
  const far = etaLineFor('accepted', { lat: 34.8, lng: -82.83 }, places)
  const close = etaLineFor('arriving', { lat: 34.681, lng: -82.83 }, places)
  assert.notEqual(far, close)
  assert.match(close, /to pickup/)
  assert.equal(etaLineFor('arrived', null, places), 'Driver is at pickup')
  assert.equal(liveDriverTitle('Sam Okonkwo', 'Next driver'), 'Sam Okonkwo')
  assert.equal(liveDriverTitle('', 'Next driver'), 'Your driver')
  assert.equal(liveDriverTitle(null, 'your driver'), 'Your driver')
  assert.equal(liveDriverTitle(null, 'Jordan'), 'Jordan')
  assert.match(etaLineFor('in_progress', { lat: 34.681, lng: -82.83 }, places), /to drop-off/)
  assert.equal(etaLineFor('completed', { lat: 34.681, lng: -82.83 }, places), null)
  assert.equal(etaLineFor('accepted', { lat: 91, lng: -82.83 }, places), null)
  assert.equal(etaLineFor('accepted', { lat: 34.68, lng: -82.83 }, { pickup_lat: '', pickup_lng: '' }), null)
  assert.equal(riderLiveView('arriving').steps[2].label, 'Arriving')
})
