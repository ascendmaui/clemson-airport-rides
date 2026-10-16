import assert from 'node:assert/strict'
import test from 'node:test'
import { priceDriverRequest } from './authoritativeFare.js'
import {
  CARPOOL_SEAT_FRACTION_BPS,
  quoteFare,
  resolveSurge,
  scaleCents,
} from '../src/lib/fareRates.js'
import { capturePlan, fareAuthorizationCents, isCarpoolFareHold } from '../shared/fareAuthorization.js'
import { holdQuoteCents } from '../shared/scheduledBoost.js'
import { chargePlan, quoteCarpool } from '../src/lib/carpoolEngine.js'
import { riderCaptureFareCents } from '../shared/backupDriverQueue.js'

const QUIET = new Date('2026-09-23T15:00:00Z')
const PLACES = {
  pickup: { label: 'A', lat: 34.68, lng: -82.84 },
  dropoff: { label: 'B', lat: 34.69, lng: -82.85 },
}

function standardFare(options) {
  return priceDriverRequest(PLACES, options)
}

test('one Carpool seat is 50% of Standard and the hold equals that quote', () => {
  const options = { at: QUIET, distanceM: 8000, durationS: 900, isStudent: false }
  const standard = standardFare(options)
  const one = priceDriverRequest(PLACES, { ...options, tier: 'carpool', seatCount: 1, isStudent: true })
  assert.equal(one.fareCents, scaleCents(standard.fareCents, CARPOOL_SEAT_FRACTION_BPS))
  assert.equal(one.perSeatFareCents, one.fareCents)
  assert.equal(one.seatCount, 1)
  assert.equal(one.isStudent, false)

  const hold = holdQuoteCents(one.fareCents, 0, 0, { bufferBps: 0 })
  assert.equal(hold.bufferCents, 0)
  assert.equal(hold.authorizationCents, one.fareCents)
  assert.equal(fareAuthorizationCents(one.fareCents, { bufferBps: 0 }).authorizationCents, one.fareCents)

  const capture = capturePlan({ authorizationCents: hold.authorizationCents, finalFareCents: one.fareCents })
  assert.equal(capture.action, 'capture')
  assert.equal(capture.captureCents, one.fareCents)
  assert.equal(riderCaptureFareCents({ fare_cents: one.fareCents, tier: 'carpool' }), one.fareCents)
  assert.equal(isCarpoolFareHold({ metadata: { ride_option: 'carpool' } }), true)
  assert.equal(isCarpoolFareHold({ tier: 'standard' }), false)
})

test('two Carpool seats are twice the half-fare seat and the hold equals that quote', () => {
  const options = { at: QUIET, distanceM: 8000, durationS: 900, isStudent: false }
  const one = priceDriverRequest(PLACES, { ...options, tier: 'carpool', seatCount: 1 })
  const two = priceDriverRequest(PLACES, { ...options, tier: 'carpool', seatCount: 2 })
  assert.equal(two.perSeatFareCents, one.fareCents)
  assert.equal(two.fareCents, one.fareCents * 2)
  assert.equal(priceDriverRequest(PLACES, { ...options, tier: 'standard', seatCount: 2 }).fareCents, standardFare(options).fareCents)

  const hold = holdQuoteCents(two.fareCents, 0, 0, { bufferBps: 0 })
  assert.equal(hold.authorizationCents, two.fareCents)
  assert.equal(hold.bufferCents, 0)
  const capture = capturePlan({ authorizationCents: hold.authorizationCents, finalFareCents: two.fareCents })
  assert.equal(capture.captureCents, two.fareCents)
  assert.equal(riderCaptureFareCents({ fare_cents: two.fareCents }), two.fareCents)
})

test('marketplace Carpool share is 50% of the Standard fare for that hop', () => {
  const hop = { distanceM: 8000, durationS: 900 }
  const surge = resolveSurge({ at: QUIET, airport: false })
  const standard = quoteFare({
    ...hop,
    surgeMultiplier: surge.multiplier,
    tier: 'standard',
    isStudent: false,
    isCarpool: false,
  })
  const seat = scaleCents(standard.fareBeforeCreditsCents, CARPOOL_SEAT_FRACTION_BPS)
  const riders = ['a', 'b', 'c', 'd'].map((id) => ({
    id,
    pickup: PLACES.pickup,
    dropoff: PLACES.dropoff,
    departAt: QUIET,
    ...hop,
  }))
  const quote = quoteCarpool({ riders, at: QUIET })
  assert.equal(quote.riderCount, 4)
  assert.equal(quote.shareOfSolo, 0.5)
  for (const share of quote.shares) {
    assert.equal(share.soloCents, standard.fareBeforeCreditsCents)
    assert.equal(share.shareCents, seat)
  }
  const plan = chargePlan(quote)
  assert.equal(plan.chargedCents, seat * 4)
  assert.equal(plan.chargedCents, quote.grossCents)
})
