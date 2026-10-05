import assert from 'node:assert/strict'
import test from 'node:test'
import { isBlockedRideTier } from './rideOptions.js'
import { cardDepositCents } from '../src/lib/fareRates.js'
import { priceScheduledRequest } from '../server/authoritativeFare.js'
import {
  TIGER_PASS_DISCOUNT_BPS,
  TIGER_PASS_NAME,
  TIGER_PASS_PRICE_CENTS,
  applyTigerPassDiscount,
  assertPreferredCarTypes,
  filterPreferredCarTypes,
  subscriptionIsActive,
  tigerPassCopy,
} from './tigerPass.js'

const QUIET = new Date('2026-09-23T15:00:00.000Z')

test('the rename hook is the only display name', () => {
  assert.equal(TIGER_PASS_NAME, 'Tiger Pass')
  assert.equal(tigerPassCopy().name, TIGER_PASS_NAME)
  assert.match(tigerPassCopy().summary, new RegExp(TIGER_PASS_NAME))
  assert.equal(tigerPassCopy('Night Game Pass').name, 'Night Game Pass')
  assert.equal(TIGER_PASS_PRICE_CENTS, 999)
  assert.equal(TIGER_PASS_DISCOUNT_BPS, 1000)
})

test('preferred ride types stay on the three offered options', () => {
  assert.deepEqual(assertPreferredCarTypes(['comfort', 'wait', 'standard', 'wait']), ['comfort', 'wait', 'standard'])
  assert.deepEqual(filterPreferredCarTypes(['xl', 'pet', 'standard']), ['standard'])
  const blocked = ['te', 'sla'].join('')
  const blockedRobot = ['robo', 'taxi'].join('')
  assert.equal(isBlockedRideTier(blocked), true)
  assert.throws(() => assertPreferredCarTypes([blocked]), /Standard, Wait & Save, and Extra Comfort/)
  assert.throws(() => assertPreferredCarTypes([blockedRobot, 'comfort']), /Standard, Wait & Save, and Extra Comfort/)
  assert.throws(() => assertPreferredCarTypes(['xl']), /Standard, Wait & Save, and Extra Comfort/)
})

test('an active pass discounts after the student rate and reprices a deposit', () => {
  const campus = { label: 'Sikes Hall', lat: 34.6795, lng: -82.8374 }
  const downtown = { label: 'Downtown Clemson', lat: 34.6836, lng: -82.8364 }
  const base = priceScheduledRequest({
    pickup: campus,
    dropoff: downtown,
    at: QUIET,
    isStudent: true,
    tier: 'standard',
    distanceM: 2000,
    durationS: 400,
  })
  const pass = priceScheduledRequest({
    pickup: campus,
    dropoff: downtown,
    at: QUIET,
    isStudent: true,
    tier: 'comfort',
    distanceM: 2000,
    durationS: 400,
    tigerPassBps: TIGER_PASS_DISCOUNT_BPS,
  })
  const studentPass = priceScheduledRequest({
    pickup: campus,
    dropoff: downtown,
    at: QUIET,
    isStudent: true,
    tier: 'standard',
    distanceM: 2000,
    durationS: 400,
    tigerPassBps: TIGER_PASS_DISCOUNT_BPS,
  })
  assert.equal(pass.tigerPassApplied, true)
  assert.equal(pass.tigerPassName, TIGER_PASS_NAME)
  assert.equal(pass.fareCents, Math.round(pass.breakdown.fare_before_tiger_pass_cents * 0.9))
  assert.equal(studentPass.discountCents, base.discountCents)
  assert.ok(studentPass.fareCents < base.fareCents)
  assert.equal(studentPass.fareCents, applyTigerPassDiscount(base, TIGER_PASS_DISCOUNT_BPS).fareCents)

  const airport = applyTigerPassDiscount(
    { fareCents: 9000, depositCents: 2250, breakdown: {}, quote: { fareBeforeCreditsCents: 9000, breakdown: {} } },
    TIGER_PASS_DISCOUNT_BPS,
  )
  assert.equal(airport.fareCents, 8100)
  assert.equal(airport.depositCents, cardDepositCents(8100))
  assert.equal(airport.quote.fareBeforeCreditsCents, 8100)
  assert.equal(applyTigerPassDiscount(base, 0), base)
})

test('a pass is active only through the paid period', () => {
  const now = new Date('2026-10-05T12:00:00.000Z')
  assert.equal(subscriptionIsActive({ status: 'active', current_period_end: '2026-11-01T00:00:00.000Z' }, now), true)
  assert.equal(subscriptionIsActive({ status: 'active', current_period_end: '2026-10-01T00:00:00.000Z' }, now), false)
  assert.equal(subscriptionIsActive({ status: 'canceled', current_period_end: '2026-11-01T00:00:00.000Z' }, now), false)
  assert.equal(subscriptionIsActive({ status: 'past_due' }, now), false)
  assert.equal(subscriptionIsActive(null, now), false)
})
