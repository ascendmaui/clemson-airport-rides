import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FARE_CARD,
  CREDIT_PACKS,
  quoteFare,
  quoteWaitCancelFee,
  splitPlatformFee,
  resolveSurge,
  applyCreditLots,
  finalizeSettlement,
  STUDENT_DISCOUNT_BPS,
  CARPOOL_DISCOUNT_BPS,
  PLATFORM_FEE_BPS,
} from './fareRates.js'

test('credit pack anchor is $100 → 10%, with $50/5% and $200/15%', () => {
  assert.deepEqual(
    CREDIT_PACKS.map((p) => [p.loadCents, p.discountBps]),
    [[5000, 500], [10000, 1000], [20000, 1500]],
  )
  assert.equal(STUDENT_DISCOUNT_BPS, 1000)
  assert.equal(CARPOOL_DISCOUNT_BPS, 1500)
  assert.equal(PLATFORM_FEE_BPS, 2000)
})

test('7-minute auto-cancel is $5 → platform $1, driver $4', () => {
  const fee = quoteWaitCancelFee()
  assert.equal(fee.amountCents, 500)
  assert.equal(fee.platformFeeCents, 100)
  assert.equal(fee.driverEarningsCents, 400)
  assert.equal(fee.afterMinutes, 7)
})

test('short ride floors at the UberX minimum', () => {
  const q = quoteFare({ miles: 0.2, minutes: 2 })
  assert.equal(q.fareBeforeCreditsCents, FARE_CARD.minFareCents)
  assert.equal(q.breakdown.min_fare_applied, true)
  const split = splitPlatformFee(q.fareCents)
  assert.equal(q.platformFeeCents, split.platformFeeCents)
  assert.equal(q.platformFeeCents + q.driverEarningsCents, q.fareCents)
})

test('10 miles / 15 min uses base + booking + per mile + per minute', () => {
  const q = quoteFare({ miles: 10, minutes: 15 })
  const expected = FARE_CARD.baseCents
    + FARE_CARD.bookingFeeCents
    + Math.round(10 * FARE_CARD.perMileCents)
    + Math.round(15 * FARE_CARD.perMinuteCents)
  assert.equal(q.fareBeforeDiscountsCents, expected)
  assert.equal(q.breakdown.min_fare_applied, false)
})

test('surge applies after the metered fare and before discounts', () => {
  const base = quoteFare({ miles: 10, minutes: 15, surgeMultiplier: 1 })
  const surged = quoteFare({ miles: 10, minutes: 15, surgeMultiplier: 1.35 })
  assert.equal(surged.fareBeforeDiscountsCents, Math.round(base.fareBeforeDiscountsCents * 1.35))
  assert.ok(surged.fareCents > base.fareCents)
})

test('surge cap is 2.5 and rules do not multiply together', () => {
  const at = new Date('2026-09-26T20:00:00Z') // Saturday 16:00 EDT, rush + football window
  const surge = resolveSurge({ at, airport: true, gameDayMultiplier: 3 })
  assert.equal(surge.multiplier, 2.5)
  assert.equal(surge.rule.id, 'game_day')
  assert.ok(surge.matched.some((m) => m.id === 'weekend'))
  assert.ok(surge.matched.some((m) => m.id === 'airport_rush'))
})

test('weekday airport rush and quiet midday', () => {
  const rush = resolveSurge({ at: new Date('2026-09-23T20:00:00Z'), airport: true })
  assert.equal(rush.multiplier, 1.35)
  assert.equal(rush.rule.id, 'airport_rush')
  const quiet = resolveSurge({ at: new Date('2026-09-22T16:00:00Z'), airport: false })
  assert.equal(quiet.multiplier, 1)
  const friday = resolveSurge({ at: new Date('2026-09-25T22:00:00Z'), airport: false })
  assert.equal(friday.multiplier, 1.2)
  assert.equal(friday.rule.id, 'weekend')
})

test('stacking is carpool then student then prepaid on credits only', () => {
  const plain = quoteFare({ miles: 10, minutes: 20 })
  const stacked = quoteFare({
    miles: 10,
    minutes: 20,
    isCarpool: true,
    isStudent: true,
    useCredits: true,
    creditLots: [{ id: 'lot', remainingCents: 100000, discountBps: 1000 }],
  })
  const afterCarpool = plain.fareBeforeDiscountsCents
    - Math.round(plain.fareBeforeDiscountsCents * 0.15)
  const afterStudent = afterCarpool - Math.round(afterCarpool * 0.1)
  const afterPrepaid = afterStudent - Math.round(afterStudent * 0.1)
  assert.equal(stacked.fareBeforeCreditsCents, afterStudent)
  assert.equal(stacked.fareCents, afterPrepaid)
  assert.equal(stacked.cashCents, 0)
  assert.equal(stacked.platformFeeCents + stacked.driverEarningsCents, stacked.fareCents)
  assert.equal(stacked.platformFeeCents, splitPlatformFee(afterPrepaid).platformFeeCents)
})

test('prepaid discount does not apply to the card remainder', () => {
  const fare = 2000
  const applied = applyCreditLots(fare, [{ id: 'a', remainingCents: 500, discountBps: 1000 }])
  assert.equal(applied.creditsDebitedCents, 500)
  assert.ok(applied.cashCents > 0)
  assert.ok(applied.creditDiscountCents > 0)
  assert.equal(applied.creditsDebitedCents + applied.creditDiscountCents + applied.cashCents, fare)
  const settled = finalizeSettlement(applied)
  assert.equal(settled.riderPaysCents, settled.creditsDebitedCents + settled.cashCents)
})

test('two lots keep their own percents (FIFO)', () => {
  const applied = applyCreditLots(10000, [
    { id: 'small', remainingCents: 5000, discountBps: 500 },
    { id: 'mid', remainingCents: 10000, discountBps: 1000 },
  ])
  assert.equal(applied.debits.length, 2)
  assert.equal(applied.debits[0].discountBps, 500)
  assert.equal(applied.debits[1].discountBps, 1000)
  assert.equal(applied.cashCents, 0)
  assert.equal(applied.creditsDebitedCents + applied.creditDiscountCents, 10000)
})

test('student discount stays off non-standard tiers', () => {
  const standard = quoteFare({ miles: 8, minutes: 12, isStudent: true, tier: 'standard' })
  const comfort = quoteFare({ miles: 8, minutes: 12, isStudent: true, tier: 'comfort' })
  assert.ok(standard.breakdown.student_discount_cents > 0)
  assert.equal(comfort.breakdown.student_discount_cents, 0)
})
