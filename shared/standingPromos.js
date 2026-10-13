/**
 * Standing offers. They stay on the homepage every week.
 * Automatic ride discounts do not stack with each other or with the Friday code.
 * The prepaid 25% bonus is not a ride discount and does not apply to other packs.
 */
import { studentDiscountGranted } from '../src/lib/studentDomain.js'

export const FIRST_RIDE_DISCOUNT_BPS = 5000
export const THRESHOLD_FARE_EXCLUSIVE_CENTS = 2000
export const THRESHOLD_RIDES_REQUIRED = 2
export const THRESHOLD_DISCOUNT_BPS = 5000
export const EDU_FRIENDS_FOR_FREE_RIDE = 2
export const PREPAID_BONUS_PACKAGE_ID = 'credits_100_for_75'

export const STANDING_OFFERS = [
  {
    id: 'first-ride-50',
    kicker: 'Always on',
    title: '50% off your first ride',
    detail: 'A new account’s first completed trip is half off. No code to enter.',
    automatic: true,
  },
  {
    id: 'refer-two-edu',
    kicker: 'Students',
    title: 'Refer two friends, ride free',
    detail: 'Both friends have to sign up and confirm a @clemson.edu or @g.clemson.edu email. Any other address does not count.',
    automatic: true,
  },
  {
    id: 'two-rides-over-20',
    kicker: 'No code',
    title: 'Two rides over $20, then half off',
    detail: 'After two completed rides that each cost more than $20, the next ride is 50% off. The offer tracks that rider’s booking history.',
    automatic: true,
  },
  {
    id: 'credits-100-for-75',
    kicker: 'Prepaid',
    title: '$100 ride credits for $75',
    detail: 'Buy this package in Stripe and the wallet receives $100. The 25% bonus value is defined only on this prepaid package.',
    automatic: false,
    purchasable: true,
  },
]

function completedFareCents(ride) {
  const status = String(ride?.status || (ride?.completed === true ? 'completed' : '')).toLowerCase()
  if (status !== 'completed') return null
  const cents = Math.round(Number(ride.fareCents ?? ride.fare_cents ?? ride.amountCents ?? ride.amount_cents) || 0)
  if (!Number.isFinite(cents) || cents < 0) return null
  return cents
}

/** Clemson student verification: confirmed @clemson.edu or @g.clemson.edu. */
export function isVerifiedEduSignup(user) {
  return studentDiscountGranted(user)
}

export function eduReferralProgress(friends) {
  const list = Array.isArray(friends) ? friends : []
  const verifiedCount = list.filter((friend) => isVerifiedEduSignup(friend)).length
  return {
    required: EDU_FRIENDS_FOR_FREE_RIDE,
    verifiedCount,
    ignoredNonEdu: list.length - verifiedCount,
    earned: verifiedCount >= EDU_FRIENDS_FOR_FREE_RIDE,
  }
}

export function firstRideProgress(rides) {
  const completedCount = (Array.isArray(rides) ? rides : []).filter((ride) => completedFareCents(ride) != null).length
  const eligible = completedCount === 0
  return {
    completedCount,
    eligible,
    discountBps: eligible ? FIRST_RIDE_DISCOUNT_BPS : 0,
  }
}

export function thresholdProgress(rides, { redeemed = false } = {}) {
  const qualifyingCount = (Array.isArray(rides) ? rides : []).filter((ride) => {
    const fare = completedFareCents(ride)
    return fare != null && fare > THRESHOLD_FARE_EXCLUSIVE_CENTS
  }).length
  const eligible = qualifyingCount >= THRESHOLD_RIDES_REQUIRED && !redeemed
  return {
    qualifyingCount,
    required: THRESHOLD_RIDES_REQUIRED,
    minExclusiveCents: THRESHOLD_FARE_EXCLUSIVE_CENTS,
    eligible,
    redeemed: Boolean(redeemed),
    discountBps: eligible ? THRESHOLD_DISCOUNT_BPS : 0,
  }
}

function discountCentsFor(fare, offer) {
  if (!offer) return 0
  if (offer.bps) return Math.min(fare, Math.round(fare * offer.bps / 10000))
  if (offer.amountOffCents) return Math.min(fare, Math.round(offer.amountOffCents))
  return 0
}

/**
 * Pick a single ride discount.
 * Free ride from two verified .edu referrals, then first-ride 50%, then the
 * two-rides-over-$20 50%. The Friday coupon is used only when none of those apply.
 */
export function selectRideDiscount({
  fareCents,
  rides = [],
  eduFriends = [],
  freeRideRedeemed = false,
  thresholdRedeemed = false,
  coupon = null,
} = {}) {
  const edu = eduReferralProgress(eduFriends)
  const first = firstRideProgress(rides)
  const threshold = thresholdProgress(rides, { redeemed: thresholdRedeemed })
  let chosen = null
  if (edu.earned && !freeRideRedeemed) {
    chosen = { id: 'refer-two-edu', bps: 10000, code: null, weekly: false }
  } else if (first.eligible) {
    chosen = { id: 'first-ride-50', bps: FIRST_RIDE_DISCOUNT_BPS, code: null, weekly: false }
  } else if (threshold.eligible) {
    chosen = { id: 'two-rides-over-20', bps: THRESHOLD_DISCOUNT_BPS, code: null, weekly: false }
  } else if (coupon && (coupon.percentOffBps || coupon.amountOffCents)) {
    chosen = {
      id: coupon.id,
      bps: Number(coupon.percentOffBps) || 0,
      amountOffCents: Number(coupon.amountOffCents) || 0,
      code: coupon.code || null,
      weekly: true,
    }
  }
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  const discountCents = discountCentsFor(fare, chosen)
  return {
    edu,
    first,
    threshold,
    offerId: chosen?.id || null,
    code: chosen?.code || null,
    weekly: Boolean(chosen?.weekly),
    discountCents,
    fareCents: fare - discountCents,
  }
}
