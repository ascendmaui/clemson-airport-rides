import assert from 'node:assert/strict'
import test from 'node:test'
import { OPEN_POOL_COPY, PREFERRED_CANCELED_COPY, PREFERRED_MATCH_COPY } from './drivers.js'
import { acceptActionLabel, declineActionLabel, driverStatusDetail } from './tripTags.js'
import {
  DRIVER_TRACK_STEPS,
  etaLineFor,
  riderLiveStepIndex,
  riderLiveSteps,
  riderLiveView,
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
