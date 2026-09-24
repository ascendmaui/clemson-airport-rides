import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { studentDiscountGranted } from '../src/lib/studentDomain.js'
import { cardDepositCents, STUDENT_DISCOUNT_BPS } from '../src/lib/fareRates.js'
import { ATL_FLOOR_CENTS } from '../src/lib/scheduledRideModel.js'
import {
  amountDueIgnoringClient,
  priceCheckoutBody,
  priceScheduledRequest,
  quoteAirportCheckout,
  serverCollectCents,
} from './authoritativeFare.js'

const QUIET = new Date('2026-09-23T15:00:00Z')
const GMAIL = {
  email: 'spoof@gmail.com',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  student_verified_at: '2026-01-01T00:00:00Z',
}
const TIGER = {
  email: 'tiger@g.clemson.edu',
  email_confirmed_at: '2026-01-01T00:00:00Z',
}
const CAMPUS = { label: 'Cooper Library', lat: 34.6757, lng: -82.8365 }
const DOWNTOWN = { label: 'Downtown Clemson', lat: 34.6834, lng: -82.8374 }

test('spoofed checkout fare and student flag cannot lower the deposit', () => {
  const full = quoteAirportCheckout({ airport: 'GSP', at: QUIET, isStudent: false })
  const priced = priceCheckoutBody({
    body: {
      airport: 'GSP',
      fareCents: 100,
      fare_cents: 100,
      depositCents: 25,
      amount: 25,
      total: 1,
      isStudent: true,
    },
    user: GMAIL,
    at: QUIET,
    gameDayMultiplier: null,
  })
  assert.equal(studentDiscountGranted(GMAIL), false)
  assert.equal(priced.isStudent, false)
  assert.equal(priced.spoofedStudent, true)
  assert.equal(priced.clientUnderpaid, true)
  assert.equal(priced.fareCents, full.fareCents)
  assert.equal(priced.unitAmount, full.depositCents)
  assert.equal(priced.depositCents, cardDepositCents(full.fareCents))
  assert.ok(priced.unitAmount > 25)
  assert.ok(priced.fareCents > 100)
})

test('confirmed clemson email keeps 10% off Standard and 25% of that fare', () => {
  const full = quoteAirportCheckout({ airport: 'GSP', at: QUIET, isStudent: false })
  const student = quoteAirportCheckout({ airport: 'CLT', at: QUIET, isStudent: true })
  const gspStudent = quoteAirportCheckout({ airport: 'GSP', at: QUIET, isStudent: true })
  const discount = Math.round((full.fareCents * STUDENT_DISCOUNT_BPS) / 10000)
  assert.equal(gspStudent.fareCents, full.fareCents - discount)
  assert.equal(gspStudent.depositCents, cardDepositCents(gspStudent.fareCents))
  assert.equal(gspStudent.quote.breakdown.student_discount_bps, STUDENT_DISCOUNT_BPS)
  assert.ok(student.fareCents > gspStudent.fareCents)
  const priced = priceCheckoutBody({
    body: { airport: 'GSP', fareCents: 100, isStudent: false },
    user: TIGER,
    at: QUIET,
  })
  assert.equal(priced.isStudent, true)
  assert.equal(priced.fareCents, gspStudent.fareCents)
  assert.equal(priced.unitAmount, gspStudent.depositCents)
  assert.ok(priced.unitAmount > 25)
})

test('spoofed campus fare and student flag do not set the recorded fare', () => {
  const full = priceScheduledRequest({
    pickup: CAMPUS,
    dropoff: DOWNTOWN,
    at: QUIET,
    isStudent: false,
    tier: 'standard',
  })
  const spoof = priceScheduledRequest({
    pickup: CAMPUS,
    dropoff: DOWNTOWN,
    at: QUIET,
    isStudent: studentDiscountGranted(GMAIL),
    tier: 'standard',
  })
  const student = priceScheduledRequest({
    pickup: CAMPUS,
    dropoff: DOWNTOWN,
    at: QUIET,
    isStudent: studentDiscountGranted(TIGER),
    tier: 'standard',
  })
  assert.equal(spoof.fareCents, full.fareCents)
  assert.ok(full.fareCents > 100)
  assert.equal(full.depositCents, 0)
  const discount = Math.round((full.fareCents * STUDENT_DISCOUNT_BPS) / 10000)
  assert.equal(student.fareCents, full.fareCents - discount)
  assert.ok(student.fareCents > 100)
  const tesla = priceScheduledRequest({
    pickup: CAMPUS,
    dropoff: DOWNTOWN,
    at: QUIET,
    isStudent: true,
    tier: 'tesla',
  })
  assert.equal(tesla.fareCents, full.fareCents)
  assert.equal(tesla.isStudent, false)
})

test('a short ATL pin cannot price below the existing Atlanta floor', () => {
  const atl = priceScheduledRequest({
    pickup: CAMPUS,
    dropoff: { label: 'Hartsfield-Jackson Atlanta (ATL)', lat: CAMPUS.lat + 0.01, lng: CAMPUS.lng },
    at: QUIET,
    isStudent: false,
  })
  assert.ok(atl.fareCents >= ATL_FLOOR_CENTS)
  const student = priceScheduledRequest({
    pickup: CAMPUS,
    dropoff: { label: 'Hartsfield-Jackson Atlanta (ATL)', lat: CAMPUS.lat + 0.01, lng: CAMPUS.lng },
    at: QUIET,
    isStudent: true,
  })
  assert.equal(student.fareCents, ATL_FLOOR_CENTS - Math.round((ATL_FLOOR_CENTS * STUDENT_DISCOUNT_BPS) / 10000))
})

test('airport schedule uses the server airport quote, not a short client distance', () => {
  const airport = priceScheduledRequest({
    pickup: CAMPUS,
    dropoff: { label: 'GSP Airport', lat: CAMPUS.lat, lng: CAMPUS.lng },
    at: QUIET,
    isStudent: false,
  })
  const canonical = quoteAirportCheckout({ airport: 'GSP', at: QUIET, isStudent: false })
  assert.equal(airport.fareCents, canonical.fareCents)
  assert.equal(airport.depositCents, cardDepositCents(canonical.fareCents))
})

test('collect and settle ignore a spoofed low amount', () => {
  const trip = { fare_cents: 10000, deposit_cents: 100, metadata: {}, fare_breakdown: {} }
  const balance = serverCollectCents({
    kind: 'balance',
    trip,
    payments: [{ status: 'succeeded', kind: 'deposit', amount_cents: 2500 }],
    clientAmountCents: 50,
  })
  assert.equal(balance.amountCents, 7500)
  assert.equal(balance.clientUnderpaid, true)
  const deposit = serverCollectCents({
    kind: 'deposit',
    trip,
    payments: [],
    clientAmountCents: 25,
  })
  assert.equal(deposit.amountCents, cardDepositCents(10000))
  assert.ok(deposit.amountCents > 100)
  const settle = amountDueIgnoringClient({
    action: 'complete',
    trip,
    payments: [],
    clientAmountCents: 50,
  })
  assert.equal(settle.amountCents, 10000)
  assert.equal(settle.clientUnderpaid, true)
  const cancel = amountDueIgnoringClient({
    action: 'cancel',
    trip: { ...trip, metadata: { cancel_fee_cents: 1500 } },
    clientAmountCents: 0,
  })
  assert.equal(cancel.amountCents, 1500)
  assert.equal(cancel.clientUnderpaid, true)
})

test('checkout and trip create do not price from client money or isStudent', () => {
  const checkout = readFileSync(new URL('../api/create-checkout-session.js', import.meta.url), 'utf8')
  const schedule = readFileSync(new URL('./endpoints/scheduleTrip.js', import.meta.url), 'utf8')
  const collect = readFileSync(new URL('./endpoints/collectPayment.js', import.meta.url), 'utf8')
  const settle = readFileSync(new URL('./endpoints/tripSettle.js', import.meta.url), 'utf8')
  assert.doesNotMatch(checkout, /Number\(body\.fareCents\)/)
  assert.doesNotMatch(checkout, /body\.isStudent/)
  assert.match(checkout, /priceCheckoutBody/)
  assert.match(checkout, /studentDiscountGranted/)
  assert.doesNotMatch(schedule, /body\.isStudent/)
  assert.doesNotMatch(schedule, /body\.fareCents|body\.fare_cents|body\.amount|body\.total/)
  assert.match(schedule, /studentDiscountGranted/)
  assert.match(schedule, /priceScheduledRequest/)
  assert.match(collect, /serverCollectCents/)
  assert.doesNotMatch(collect, /Math\.round\(Number\(body\.amountCents\)\)/)
  assert.doesNotMatch(settle, /explicitAmountCents:\s*body\.amountCents/)
  assert.match(settle, /amountDueIgnoringClient/)
})
