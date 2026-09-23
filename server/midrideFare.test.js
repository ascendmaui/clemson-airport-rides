import assert from 'node:assert/strict'
import test from 'node:test'
import {
  abuseDecision,
  haversineMeters,
  isMidrideEligible,
  pathMeters,
  quoteMidrideCancel,
  splitObligation,
  FARE_RATES,
} from './midrideFare.js'

test('split is 20% platform and 80% driver and sums to the obligation', () => {
  for (const cents of [0, 1, 500, 1000, 1001, 7500, 17500]) {
    const split = splitObligation(cents)
    assert.equal(split.platformCents + split.driverCents, split.obligationCents)
    assert.equal(split.platformCents, Math.round(cents * 0.2))
    assert.equal(split.driverCents, cents - split.platformCents)
  }
})

test('immediate cancel still bills base fare plus the cancel fee', () => {
  const q = quoteMidrideCancel({
    quotedFareCents: 7500,
    distanceM: 0,
    straightM: 1609.344 * 40,
    durationS: 0,
    depositPaidCents: 0,
  })
  assert.equal(q.meteredCents, FARE_RATES.baseCents)
  assert.equal(q.ridePortionCents, FARE_RATES.baseCents)
  assert.equal(q.cancelFeeCents, FARE_RATES.cancelFeeCents)
  assert.equal(q.obligationCents, FARE_RATES.baseCents + FARE_RATES.cancelFeeCents)
  assert.equal(q.toCollectCents, q.obligationCents)
  assert.equal(q.platformCents + q.driverCents, q.obligationCents)
})

test('GPS progress bills the larger of the meter and the share of the quoted fare', () => {
  const straight = 1609.344 * 40
  const traveled = straight * 0.5
  const q = quoteMidrideCancel({
    quotedFareCents: 7500,
    distanceM: traveled,
    straightM: straight,
    durationS: 60,
  })
  assert.ok(q.fraction >= 0.5)
  assert.equal(q.progressFareCents, 3750)
  const miles = traveled / 1609.344
  const metered = FARE_RATES.baseCents + Math.round(miles * FARE_RATES.perMileCents) + Math.round((60 / 60) * FARE_RATES.perMinuteCents)
  assert.equal(q.meteredCents, metered)
  assert.equal(q.ridePortionCents, Math.max(metered, 3750))
  assert.equal(q.obligationCents, q.ridePortionCents + FARE_RATES.cancelFeeCents)
  assert.ok(q.obligationCents < 7500 + FARE_RATES.cancelFeeCents)
})

test('a nearly finished trip is capped at quoted fare plus the cancel fee', () => {
  const straight = 1609.344 * 10
  const q = quoteMidrideCancel({
    quotedFareCents: 7500,
    distanceM: straight * 2,
    straightM: straight,
    durationS: 7200,
  })
  assert.equal(q.fraction, 1)
  assert.equal(q.ridePortionCents, 7500)
  assert.equal(q.obligationCents, 7500 + FARE_RATES.cancelFeeCents)
})

test('missing GPS still prices from elapsed time versus a 30 mph expectation', () => {
  const straight = 1609.344 * 30
  const expectedS = straight / 13.4112
  const q = quoteMidrideCancel({
    quotedFareCents: 17500,
    distanceM: 0,
    straightM: straight,
    durationS: expectedS / 2,
  })
  assert.ok(Math.abs(q.elapsedFraction - 0.5) < 0.02)
  assert.equal(q.progressFareCents, 8750)
  assert.equal(q.ridePortionCents, 8750)
})

test('deposit already captured reduces the new card charge and not the driver share', () => {
  const q = quoteMidrideCancel({
    quotedFareCents: 7500,
    distanceM: 0,
    straightM: 1000,
    durationS: 0,
    depositPaidCents: 1875,
  })
  assert.equal(q.obligationCents, FARE_RATES.baseCents + FARE_RATES.cancelFeeCents)
  assert.equal(q.toCollectCents, 0)
  assert.equal(q.driverCents, q.obligationCents - q.platformCents)
  assert.ok(q.driverCents > 0)
})

test('abuse rule blocks the attempt after N cancels in the window', () => {
  assert.equal(abuseDecision(0, 3).blocked, false)
  assert.equal(abuseDecision(2, 3).remaining, 1)
  assert.equal(abuseDecision(3, 3).blocked, true)
  assert.equal(abuseDecision(4, 3).blocked, true)
})

test('pre-start arriving or arrived is not a mid-ride cancel', () => {
  assert.equal(isMidrideEligible('in_progress'), true)
  assert.equal(isMidrideEligible('arriving', { started: false }), false)
  assert.equal(isMidrideEligible('arriving', { started: true }), true)
  assert.equal(isMidrideEligible('arrived', { started: false }), false)
  assert.equal(isMidrideEligible('arrived', { started: true }), true)
  assert.equal(isMidrideEligible('cancelled_wait'), false)
  assert.equal(isMidrideEligible('accepted'), false)
  assert.equal(isMidrideEligible('searching'), false)
})

test('path distance ignores GPS teleports', () => {
  const points = [
    { lat: 34.678, lng: -82.843 },
    { lat: 34.679, lng: -82.843 },
    { lat: 40.0, lng: -82.843 },
  ]
  const path = pathMeters(points)
  const firstHop = haversineMeters(points[0], points[1])
  assert.ok(path < 200)
  assert.ok(Math.abs(path - firstHop) < 1)
})
