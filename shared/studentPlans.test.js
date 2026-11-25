import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeRides, buildQuote, quoteFloorCents, stripeFeeCents, discountedPrice, weekendCarpoolCoverage,
  inWeekendWindow, studentPlansEnabled, studentPlanEmailSendingEnabled, validatePause, quoteEligible,
  isClemsonStudentEmail, termCode, enrollmentCurrent, activeClockDays, priceIdsFromEnv, WEEKEND_CARPOOL_PLAN,
  fallbackSummary, countsAsCompleted, PRODUCT_NAME,
} from './studentPlans.js'

// Fri Oct 9 2026 23:00 ET = Sat 03:00Z
const FRI_NIGHT = '2026-10-10T03:00:00Z'
const TUE_NOON = '2026-10-13T16:00:00Z'

test('product name is Clemson Rides', () => {
  assert.equal(PRODUCT_NAME, 'Clemson Rides')
})

test('feature flag defaults OFF and allowlist turns it on for one rider', () => {
  assert.equal(studentPlansEnabled({}), false)
  assert.equal(studentPlansEnabled({}, { id: 'u1', email: 'john@clemsonrides.com' }), false)
  const env = { STUDENT_PLANS_ALLOW_EMAILS: 'John@ClemsonRides.com' }
  assert.equal(studentPlansEnabled(env, { id: 'u1', email: 'john@clemsonrides.com' }), true)
  assert.equal(studentPlansEnabled(env, { id: 'u2', email: 'other@clemson.edu' }), false)
  assert.equal(studentPlansEnabled({ STUDENT_PLANS_ENABLED: '1' }, null), true)
  assert.equal(studentPlansEnabled({ STUDENT_PLANS_ALLOW_IDS: 'u9' }, { id: 'u9' }), true)
})

test('email sending stays off unless both switches are on', () => {
  assert.equal(studentPlanEmailSendingEnabled({}), false)
  assert.equal(studentPlanEmailSendingEnabled({ STUDENT_PLAN_EMAILS_SEND: '1' }), false)
})

test('floor = driver 80% + Stripe 2.9% + 30c, plus 15% margin', () => {
  const fares = 8448 // 16 rides × $5.28
  const floor = quoteFloorCents(fares)
  const driver = Math.round(fares * 0.8)
  const fee = stripeFeeCents(floor)
  assert.ok(floor >= Math.round((driver + fee) * 1.15) - 1)
  assert.ok(WEEKEND_CARPOOL_PLAN.monthlyCents >= floor, '$89 clears the floor for the spec example')
})

test('discounts: 10% monthly, 15% semester; the floor always wins', () => {
  assert.deepEqual(discountedPrice(10000, 5000, 1000), { cents: 9000, floorApplied: false })
  assert.deepEqual(discountedPrice(10000, 9500, 1500), { cents: 9500, floorApplied: true })
})

test('weekend window: Fri/Sat 6 PM to 4 AM ET, configurable', () => {
  assert.equal(inWeekendWindow(FRI_NIGHT), true)
  assert.equal(inWeekendWindow('2026-10-11T07:30:00Z'), true) // Sun 3:30 AM after Saturday night
  assert.equal(inWeekendWindow('2026-10-11T08:30:00Z'), false) // Sun 4:30 AM
  assert.equal(inWeekendWindow(TUE_NOON), false)
  assert.equal(inWeekendWindow(FRI_NIGHT, { startHour: 20, endHour: 22 }), false)
})

test('coverage: matched carpool 2+, surge capped at 1.2x, driver paid 80% of full fare', () => {
  const ok = weekendCarpoolCoverage({ fareCents: 1000, surgeMultiplier: 1.2, riders: 2, carpool: true, at: FRI_NIGHT })
  assert.equal(ok.covered, true)
  assert.equal(ok.label, 'Covered')
  assert.equal(ok.riderPaysCents, 0)
  const surge = weekendCarpoolCoverage({ fareCents: 1800, surgeMultiplier: 1.8, riders: 3, carpool: true, at: FRI_NIGHT })
  assert.equal(surge.coveredCents, 1200)
  assert.equal(surge.riderPaysCents, 600)
  assert.equal(surge.driverPayoutCents, 1440)
  assert.equal(weekendCarpoolCoverage({ fareCents: 1000, riders: 1, carpool: true, at: FRI_NIGHT }).covered, false)
  assert.equal(weekendCarpoolCoverage({ fareCents: 1000, riders: 2, carpool: true, at: TUE_NOON }).covered, false)
  assert.equal(weekendCarpoolCoverage({ fareCents: 1000, riders: 2, carpool: true, at: FRI_NIGHT, active: false }).covered, false)
})

function trip(i, { at, fare = 900, tier = 'carpool', surge = 1, status = 'completed', paid = 'paid' } = {}) {
  return {
    id: `t${i}`, status, payment_status: paid, tier, fare_cents: fare, surge_multiplier: surge,
    pickup_lat: 34.69, pickup_lng: -82.83, dropoff_lat: 34.683, dropoff_lng: -82.837, completed_at: at,
  }
}

function weekendHistory() {
  const out = []
  // 4 weekends of Fri+Sat nights, two rides each night, from Sep 18 2026
  for (let w = 0; w < 4; w++) {
    for (const d of [0, 1]) {
      for (const h of [0, 3]) {
        const base = Date.parse('2026-09-19T00:00:00Z') + (w * 7 + d) * 86400000 + h * 3600000
        out.push(trip(out.length, { at: new Date(base).toISOString() }))
      }
    }
  }
  return out
}

test('analysis: median fare, distance, Fri/Sat pattern; cancelled and unpaid rides ignored', () => {
  const trips = [...weekendHistory(), trip(99, { at: FRI_NIGHT, status: 'canceled' }), trip(98, { at: FRI_NIGHT, paid: 'refunded' })]
  const m = analyzeRides(trips, { now: new Date('2026-10-14T21:00:00Z') })
  assert.equal(m.rides, 16)
  assert.equal(m.medianFareCents, 900)
  assert.equal(m.pattern, 'weekend_nightlife')
  assert.equal(m.carpoolShare, 1)
  assert.ok(m.medianMiles > 0)
  assert.ok(m.homeToCampusMiles != null)
  assert.ok(m.projectedRidesPerMonth > 0)
  assert.equal(countsAsCompleted({ status: 'completed', payment_status: null }), false)
})

test('quote picks the cheapest plan that clears the floor and states the savings', () => {
  const m = analyzeRides(weekendHistory(), { now: new Date('2026-10-14T21:00:00Z') })
  const q = buildQuote(m, { now: new Date('2026-10-14T21:00:00Z') })
  assert.ok(q.planId)
  assert.ok(q.monthlyCents >= q.floorCents)
  assert.equal(q.savingsCents, q.retailMonthlyCents - q.monthlyCents)
  assert.ok(q.savingsCents > 0)
  assert.match(fallbackSummary(m, q), /a saving of \$/)
})

test('no discount below the floor: recommend Tiger Pass', () => {
  const q = buildQuote({ projectedMonthlyCostCents: 1000, projectedRidesPerMonth: 1, pattern: 'mixed' })
  assert.equal(q.recommendation, 'tiger_pass')
  assert.equal(q.planId, null)
})

test('eligibility: verified student, 5 rides, 14 days, once, opt-out respected', () => {
  const m = { totalCompleted: 5, historyDays: 20 }
  assert.equal(quoteEligible({ metrics: m, verifiedStudent: true }).ok, true)
  assert.equal(quoteEligible({ metrics: { totalCompleted: 4, historyDays: 20 }, verifiedStudent: true }).reason, 'under_five_rides')
  assert.equal(quoteEligible({ metrics: { totalCompleted: 5, historyDays: 3 }, verifiedStudent: true }).reason, 'under_14_days')
  assert.equal(quoteEligible({ metrics: m, verifiedStudent: false }).reason, 'not_verified_student')
  assert.equal(quoteEligible({ metrics: m, verifiedStudent: true, optedOut: true }).reason, 'opted_out')
  assert.equal(quoteEligible({ metrics: m, verifiedStudent: true, alreadyQuoted: true }).reason, 'already_quoted')
  assert.equal(quoteEligible({ metrics: m, verifiedStudent: true, hasPlan: true }).reason, 'has_plan')
})

test('pauses: configured break windows and leave of absence', () => {
  assert.equal(validatePause({ kind: 'winter_break' }).ok, true)
  assert.equal(validatePause({ kind: 'leave_of_absence', start: '2027-01-10', end: '2027-05-10' }).ok, true)
  assert.equal(validatePause({ kind: 'leave_of_absence', start: '2027-05-10', end: '2027-01-10' }).ok, false)
  assert.equal(validatePause({ kind: 'party' }).ok, false)
  const days = activeClockDays('2026-10-01T00:00:00Z', [{ start_date: '2026-10-05', end_date: '2026-10-09' }], new Date('2026-10-11T00:00:00Z'))
  assert.equal(days, 5)
})

test('verification helpers: clemson.edu, term codes, re-verify each semester', () => {
  assert.equal(isClemsonStudentEmail('tiger@clemson.edu'), true)
  assert.equal(isClemsonStudentEmail('tiger@g.clemson.edu'), true)
  assert.equal(isClemsonStudentEmail('tiger@clemson.edu.evil.com'), false)
  assert.equal(termCode(new Date('2026-10-14T12:00:00Z')), '2026FA')
  assert.equal(termCode(new Date('2027-02-01T12:00:00Z')), '2027SP')
  const e = { email_verified_at: 'x', status: 'verified', term_code: '2026FA' }
  assert.equal(enrollmentCurrent(e, new Date('2026-10-14T12:00:00Z')), true)
  assert.equal(enrollmentCurrent(e, new Date('2027-02-01T12:00:00Z')), false)
  assert.equal(enrollmentCurrent({ ...e, status: 'pending' }, new Date('2026-10-14T12:00:00Z')), false)
})

test('price IDs come from env only', () => {
  assert.deepEqual(priceIdsFromEnv({}).weekend_carpool, { month: null, semester: null })
  assert.equal(priceIdsFromEnv({ STRIPE_PRICE_WEEKEND_CARPOOL_MONTHLY: 'price_x' }).weekend_carpool.month, 'price_x')
})
