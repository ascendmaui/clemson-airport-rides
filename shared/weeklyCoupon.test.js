import assert from 'node:assert/strict'
import test from 'node:test'
import { STANDING_OFFERS } from './standingPromos.js'
import {
  FRIDAY_DROP_HOUR_ET,
  FRIDAY_DROP_TIME_ZONE,
  WEEKLY_COUPON_CONCEPTS,
  applyWeeklyCoupon,
  currentWeeklyCoupon,
  fridayDropEmail,
  isFridayDropWindow,
} from './weeklyCoupon.js'

const NOON_EDT = new Date('2026-10-09T16:00:00.000Z')
const BEFORE_NOON_EDT = new Date('2026-10-09T15:59:00.000Z')
const THURSDAY_EDT = new Date('2026-10-08T16:00:00.000Z')
const NOON_EST = new Date('2027-01-08T17:00:00.000Z')
const ELEVEN_EST = new Date('2027-01-08T16:00:00.000Z')

test('Friday drop is noon America/New_York in both EDT and EST', () => {
  assert.equal(FRIDAY_DROP_HOUR_ET, 12)
  assert.equal(FRIDAY_DROP_TIME_ZONE, 'America/New_York')
  assert.equal(isFridayDropWindow(NOON_EDT), true)
  assert.equal(isFridayDropWindow(BEFORE_NOON_EDT), false)
  assert.equal(isFridayDropWindow(THURSDAY_EDT), false)
  assert.equal(isFridayDropWindow(NOON_EST), true)
  assert.equal(isFridayDropWindow(ELEVEN_EST), false)
})

test('the homepage coupon flips at Friday noon and rotates to a new code', () => {
  const before = currentWeeklyCoupon(BEFORE_NOON_EDT)
  const after = currentWeeklyCoupon(NOON_EDT)
  const thursday = currentWeeklyCoupon(THURSDAY_EDT)
  assert.equal(before.dropKey, '2026-10-02')
  assert.equal(thursday.dropKey, '2026-10-02')
  assert.equal(after.dropKey, '2026-10-09')
  assert.notEqual(before.code, after.code)
  assert.notEqual(before.id, after.id)
  assert.match(after.dropLabel, /12:00 PM Eastern/)
})

test('twelve weeks later reuses a concept with a different code', () => {
  const first = currentWeeklyCoupon(NOON_EDT)
  const later = currentWeeklyCoupon(new Date('2027-01-01T17:00:00.000Z'))
  assert.equal(later.dropKey, '2027-01-01')
  assert.equal(first.conceptId, later.conceptId)
  assert.notEqual(first.code, later.code)
})

test('weekly concepts are new offers, not the standing promos', () => {
  const standing = STANDING_OFFERS.map((offer) => offer.title.toLowerCase())
  assert.equal(WEEKLY_COUPON_CONCEPTS.length >= 8, true)
  for (const concept of WEEKLY_COUPON_CONCEPTS) {
    assert.equal(standing.includes(concept.title.toLowerCase()), false)
    const blob = `${concept.title} ${concept.detail}`
    assert.doesNotMatch(blob, /first ride|25% deposit/i)
    const retiredFleet = new RegExp(['te' + 'sla', 'model' + ' 3', 'robo' + 'taxi', 'self' + '-driving'].join('|'), 'i')
    assert.equal(retiredFleet.test(blob), false)
    assert.equal(Boolean(concept.percentOffBps) === Boolean(concept.amountOffCents), false)
  }
})

test('Friday email includes the new code and the .edu referral free ride', () => {
  const coupon = currentWeeklyCoupon(NOON_EDT)
  const mail = fridayDropEmail({ coupon, firstName: 'Ava Tiger' })
  assert.match(mail.subject, new RegExp(coupon.title))
  assert.match(mail.text, new RegExp(coupon.code))
  assert.match(mail.text, /Refer two friends/i)
  assert.match(mail.text, /\.edu/)
  assert.match(mail.text, /@clemson\.edu/)
  assert.match(mail.text, /do not count/i)
  assert.match(mail.text, /pre-authorization hold/)
  assert.doesNotMatch(mail.text, /25% deposit/i)
  const retiredFleet = new RegExp(['te' + 'sla', 'robo' + 'taxi'].join('|'), 'i')
  assert.equal(retiredFleet.test(mail.text), false)
})

test('a percent coupon and a fixed coupon reduce the fare once', () => {
  const percent = applyWeeklyCoupon(4000, { percentOffBps: 3000, amountOffCents: 0 })
  assert.equal(percent.discountCents, 1200)
  assert.equal(percent.fareCents, 2800)
  const fixed = applyWeeklyCoupon(4000, { percentOffBps: 0, amountOffCents: 500 })
  assert.equal(fixed.discountCents, 500)
  const capped = applyWeeklyCoupon(300, { percentOffBps: 0, amountOffCents: 500 })
  assert.equal(capped.fareCents, 0)
})
