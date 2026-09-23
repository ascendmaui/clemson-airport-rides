import assert from 'node:assert/strict'
import test from 'node:test'
import {
  alternativesFor,
  amountDueForAction,
  applyPayoutAttempt,
  classifyStripeError,
  failureResult,
  paidTowardFareCents,
  payoutIsDue,
  payoutRetryAt,
  PAYOUT_BACKOFF_MS,
  planCollection,
  progressionGate,
  readPrecomputedFeeCents,
  resolveDriverNetCents,
  summarizeDriverEarnings,
} from '../shared/paymentFailure.js'
import { driverNetCents, platformFeeCents } from '../shared/platformFee.js'

test('platform fee is 20 percent and does not invent wait or cancel math', () => {
  assert.equal(platformFeeCents(7500), 1500)
  assert.equal(driverNetCents(7500), 6000)
  assert.equal(platformFeeCents(0), 0)
  const trip = { metadata: { wait_minutes: 40, cancel_percent: 50 } }
  assert.equal(readPrecomputedFeeCents(trip, 'wait_fee'), null)
  assert.equal(readPrecomputedFeeCents(trip, 'cancel_fee'), null)
  assert.equal(readPrecomputedFeeCents({ metadata: { wait_fee_cents: 350 } }, 'wait_fee'), 350)
  assert.equal(readPrecomputedFeeCents({ metadata: { fees: { cancelFeeCents: 900 } } }, 'cancel_fee'), 900)
})

test('driver net prefers a precomputed rates value', () => {
  assert.equal(resolveDriverNetCents({ fare_cents: 10000, metadata: { driver_net_cents: 7777 } }), 7777)
  assert.equal(resolveDriverNetCents({ fare_cents: 10000, metadata: {} }), 8000)
})

test('classify stripe failures for expired, funds, removed, and declined cards', () => {
  assert.equal(classifyStripeError({ code: 'expired_card', type: 'card_error' }), 'expired_card')
  assert.equal(classifyStripeError({ decline_code: 'insufficient_funds', code: 'card_declined' }), 'insufficient_funds')
  assert.equal(classifyStripeError({ code: 'resource_missing', message: 'No such payment_method' }), 'card_removed')
  assert.equal(classifyStripeError({ raw: { code: 'card_declined', decline_code: 'generic_decline' } }), 'card_declined')
  assert.equal(classifyStripeError({ code: 'authentication_required' }), 'authentication_required')
})

test('declined card copy offers another card and credits and keeps the trip open', () => {
  const failure = failureResult('card_declined', { amountCents: 2500 })
  assert.equal(failure.status, 'payment_required')
  assert.match(failure.message, /declined/)
  assert.match(failure.message, /stays open/)
  assert.deepEqual(alternativesFor('card_declined'), ['add_card', 'use_credits', 'buy_credits', 'retry'])
  assert.ok(alternativesFor('expired_card').includes('add_card'))
  assert.ok(alternativesFor('card_removed').includes('use_credits'))
  assert.ok(alternativesFor('credits_exhausted').includes('buy_credits'))
})

test('insufficient credits fall back to the card when one is on file', () => {
  const plan = planCollection({
    amountCents: 1000,
    creditsBalanceCents: 400,
    methods: ['credits', 'card'],
    hasCard: true,
  })
  assert.equal(plan.ok, true)
  assert.equal(plan.creditsAppliedCents, 400)
  assert.equal(plan.cardCents, 600)
})

test('insufficient credits with no card prompt to add funds and do not succeed', () => {
  const plan = planCollection({
    amountCents: 1000,
    creditsBalanceCents: 0,
    methods: ['credits'],
    hasCard: false,
  })
  assert.equal(plan.ok, false)
  assert.equal(plan.code, 'credits_insufficient')
  assert.match(plan.message, /Add funds|use a card/)
  assert.equal(plan.status, 'payment_required')
})

test('credits exhausted mid-ride with no card is a visible failure', () => {
  const plan = planCollection({
    amountCents: 1800,
    creditsBalanceCents: 0,
    methods: ['credits', 'card'],
    hasCard: false,
    midRide: true,
  })
  assert.equal(plan.ok, false)
  assert.equal(plan.code, 'credits_exhausted')
  assert.match(plan.message, /used up/)
})

test('credits exhausted mid-ride still allocate the default card for the remainder', () => {
  const plan = planCollection({
    amountCents: 1800,
    creditsBalanceCents: 200,
    methods: ['credits', 'card'],
    hasCard: true,
    midRide: true,
  })
  assert.equal(plan.ok, true)
  assert.equal(plan.creditsAppliedCents, 200)
  assert.equal(plan.cardCents, 1600)
})

test('a removed card with no credits cannot be planned as success', () => {
  const plan = planCollection({
    amountCents: 500,
    creditsBalanceCents: 0,
    methods: ['credits', 'card'],
    hasCard: false,
  })
  assert.equal(plan.ok, false)
  assert.equal(plan.code, 'no_payment_method')
})

test('$0 and admin override can progress; unpaid fare cannot', () => {
  assert.deepEqual(progressionGate({ amountDueCents: 0, payment: null }), { allow: true, reason: 'zero_due' })
  assert.equal(progressionGate({ amountDueCents: 2000, payment: { ok: true } }).allow, true)
  const blocked = progressionGate({
    amountDueCents: 2000,
    payment: failureResult('expired_card', { amountCents: 2000 }),
  })
  assert.equal(blocked.allow, false)
  assert.equal(blocked.reason, 'payment_required')
  assert.equal(progressionGate({ amountDueCents: 2000, payment: null, adminOverride: true }).reason, 'admin_override')
})

test('complete uses unpaid fare; cancel uses only a precomputed fee', () => {
  const complete = amountDueForAction({ action: 'complete', fareCents: 7500, paidCents: 1875 })
  assert.equal(complete.amountCents, 5625)
  const freeCancel = amountDueForAction({ action: 'cancel', precomputedFeeCents: null })
  assert.equal(freeCancel.amountCents, 0)
  const paidCancel = amountDueForAction({ action: 'cancel', precomputedFeeCents: 1200 })
  assert.equal(paidCancel.amountCents, 1200)
  const missing = amountDueForAction({ action: 'charge', requireFee: true, precomputedFeeCents: null })
  assert.equal(missing.code, 'fee_not_computed')
  const explicit = amountDueForAction({ action: 'cancel', explicitAmountCents: 450, precomputedFeeCents: 9999 })
  assert.equal(explicit.amountCents, 450)
})

test('fare already paid does not count tips toward the balance', () => {
  const paid = paidTowardFareCents({ metadata: {} }, [
    { status: 'succeeded', kind: 'deposit', amount_cents: 1000 },
    { status: 'succeeded', kind: 'tip', amount_cents: 500 },
    { status: 'failed', kind: 'balance', amount_cents: 4000 },
    { status: 'succeeded', kind: 'balance', amount_cents: 500, metadata: { logical_kind: 'tip' } },
  ])
  assert.equal(paid, 1000)
})

test('payout failure stays pending and backs off', () => {
  const first = applyPayoutAttempt({ status: 'pending', attempts: 0, amountCents: 6000 }, {
    ok: false,
    error: 'no_connect_account',
    now: 1_000_000,
    amountCents: 6000,
  })
  assert.equal(first.status, 'pending')
  assert.equal(first.pending, true)
  assert.equal(first.attempts, 1)
  assert.equal(first.lastError, 'no_connect_account')
  assert.equal(new Date(first.nextRetryAt).getTime(), 1_000_000 + PAYOUT_BACKOFF_MS[0])
  const secondAt = payoutRetryAt(2, 1_000_000)
  assert.equal(secondAt - 1_000_000, PAYOUT_BACKOFF_MS[1])
  assert.equal(payoutIsDue(first, 1_000_000), false)
  assert.equal(payoutIsDue(first, new Date(first.nextRetryAt).getTime()), true)
  const paid = applyPayoutAttempt(first, { ok: true, now: 2_000_000, transferId: 'tr_1', amountCents: 6000 })
  assert.equal(paid.status, 'paid')
  assert.equal(paid.pending, false)
})

test('pending payouts show up in driver earnings', () => {
  const summary = summarizeDriverEarnings([
    { id: 'a', fare_cents: 10000, metadata: { payout: { status: 'paid', amountCents: 8000 } } },
    {
      id: 'b',
      fare_cents: 5000,
      dropoff_label: 'GSP',
      metadata: { payout: { status: 'pending', amountCents: 4000, attempts: 2, lastError: 'no_connect_account' } },
    },
  ])
  assert.equal(summary.paidCents, 8000)
  assert.equal(summary.pendingCents, 4000)
  assert.equal(summary.pending[0].tripId, 'b')
  assert.equal(summary.pending[0].status, 'pending')
  assert.equal(summary.pending[0].lastError, 'no_connect_account')
})
