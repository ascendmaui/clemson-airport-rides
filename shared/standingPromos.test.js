import assert from 'node:assert/strict'
import test from 'node:test'
import { findPrepaidTier, isPrepaidPackageBonus, PREPAID_TIERS } from './prepaidTiers.js'
import {
  EDU_FRIENDS_FOR_FREE_RIDE,
  PREPAID_BONUS_PACKAGE_ID,
  STANDING_OFFERS,
  eduReferralProgress,
  selectRideDiscount,
  thresholdProgress,
} from './standingPromos.js'

const CONFIRMED = '2026-01-01T00:00:00.000Z'
const edu = (email) => ({ email, email_confirmed_at: CONFIRMED })
const done = (cents) => ({ status: 'completed', fareCents: cents })

test('standing offers are the four always-on promos', () => {
  assert.deepEqual(STANDING_OFFERS.map((offer) => offer.id), [
    'first-ride-50',
    'refer-two-edu',
    'two-rides-over-20',
    'credits-100-for-75',
  ])
  assert.equal(PREPAID_BONUS_PACKAGE_ID, 'credits_100_for_75')
})

test('a free ride counts only two verified Clemson .edu signups', () => {
  const one = eduReferralProgress([
    edu('a@clemson.edu'),
    edu('b@gmail.com'),
  ])
  assert.equal(one.verifiedCount, 1)
  assert.equal(one.ignoredNonEdu, 1)
  assert.equal(one.earned, false)
  assert.equal(one.required, EDU_FRIENDS_FOR_FREE_RIDE)

  const unconfirmed = eduReferralProgress([
    edu('a@clemson.edu'),
    { email: 'b@g.clemson.edu' },
    { email: 'c@clemson.edu', student_verified_at: CONFIRMED },
  ])
  assert.equal(unconfirmed.verifiedCount, 1)
  assert.equal(unconfirmed.earned, false)

  const both = eduReferralProgress([
    edu('a@clemson.edu'),
    edu('b@g.clemson.edu'),
    edu('c@gmail.com'),
  ])
  assert.equal(both.verifiedCount, 2)
  assert.equal(both.ignoredNonEdu, 1)
  assert.equal(both.earned, true)
})

test('two completed rides each over $20 unlock one 50% ride, and $20.00 does not qualify', () => {
  const short = thresholdProgress([done(2000), done(2000)])
  assert.equal(short.qualifyingCount, 0)
  assert.equal(short.eligible, false)
  const almost = thresholdProgress([done(2001), done(1500), { status: 'canceled', fareCents: 9000 }])
  assert.equal(almost.qualifyingCount, 1)
  const ready = thresholdProgress([done(2001), done(4500)])
  assert.equal(ready.eligible, true)
  assert.equal(ready.discountBps, 5000)
  const used = thresholdProgress([done(2001), done(4500)], { redeemed: true })
  assert.equal(used.eligible, false)
})

test('automatic discounts do not stack, and the Friday code waits its turn', () => {
  const coupon = { id: 'tillman:2026-10-09', code: 'TILLMAN261009', percentOffBps: 3000, amountOffCents: 0 }
  const first = selectRideDiscount({ fareCents: 2000, rides: [], coupon })
  assert.equal(first.offerId, 'first-ride-50')
  assert.equal(first.discountCents, 1000)
  assert.equal(first.weekly, false)

  const free = selectRideDiscount({
    fareCents: 2000,
    rides: [],
    eduFriends: [edu('a@clemson.edu'), edu('b@g.clemson.edu')],
    coupon,
  })
  assert.equal(free.offerId, 'refer-two-edu')
  assert.equal(free.fareCents, 0)

  const redeemedFree = selectRideDiscount({
    fareCents: 2000,
    rides: [],
    eduFriends: [edu('a@clemson.edu'), edu('b@clemson.edu')],
    freeRideRedeemed: true,
    coupon,
  })
  assert.equal(redeemedFree.offerId, 'first-ride-50')

  const half = selectRideDiscount({
    fareCents: 3000,
    rides: [done(2100), done(4000)],
    coupon,
  })
  assert.equal(half.offerId, 'two-rides-over-20')
  assert.equal(half.discountCents, 1500)

  const weekly = selectRideDiscount({
    fareCents: 4000,
    rides: [done(1000)],
    coupon,
  })
  assert.equal(weekly.weekly, true)
  assert.equal(weekly.code, 'TILLMAN261009')
  assert.equal(weekly.discountCents, 1200)
})

test('the $75 prepaid package is the only 25% bonus and Stripe charges 7500 cents', () => {
  const pack = findPrepaidTier('credits_100_for_75')
  assert.equal(isPrepaidPackageBonus(pack), true)
  assert.equal(pack.priceCents, 7500)
  assert.equal(pack.creditCents, 10000)
  assert.equal(pack.bonusScope, 'prepaid_package_only')
  const others = PREPAID_TIERS.filter((tier) => tier.id !== pack.id)
  assert.equal(others.some((tier) => tier.bonusScope === 'prepaid_package_only' || tier.bonusBps === 2500), false)
  assert.equal(isPrepaidPackageBonus(findPrepaidTier('credits_100')), false)
})
