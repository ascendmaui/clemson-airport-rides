import test from 'node:test'
import assert from 'node:assert/strict'
import { authorizeRideRequest, placeFareAuthorization, releaseOpenFareHold } from './fareAuthorization.js'
import { settleTrip } from './tripSettle.js'
import { buildPayoutRecord } from './payouts.js'
import { tripCompletionDb } from '../tests/fixtures/tripCompletionDb.js'
import { holdQuoteCents } from '../shared/scheduledBoost.js'
import { driverTripEarnings } from '../shared/driverTripEarnings.js'
import {
  PREPAID_TIP_MAX_CENTS, parsePrepaidTipCents, parsePrepaidTipDollars, readPrepaidTipCents, tipBoostOfferLine,
} from '../shared/prepaidTip.js'
import { offerCardGauge } from '../packages/rides-native/offerGauge.js'

function scriptedStripe() {
  const calls = []
  return {
    calls,
    paymentIntents: {
      async create(params) { calls.push({ op: 'create', params }); return { id: 'pi_new', status: 'requires_capture', amount: params.amount } },
      async cancel(id) { calls.push({ op: 'cancel', id }); return { id, status: 'canceled' } },
    },
  }
}

test('parse and read prepaid tip', () => {
  assert.deepEqual(parsePrepaidTipCents(500), { ok: true, cents: 500 })
  assert.equal(parsePrepaidTipCents(-1).ok, false)
  assert.equal(parsePrepaidTipCents(PREPAID_TIP_MAX_CENTS + 1).ok, false)
  assert.equal(parsePrepaidTipCents(1.5).ok, false)
  assert.deepEqual(parsePrepaidTipDollars('$7.25'), { ok: true, cents: 725 })
  assert.equal(readPrepaidTipCents({ prepaid_tip_cents: 500 }), 500)
  assert.equal(readPrepaidTipCents({ metadata: { prepaid_tip_cents: 200 } }), 200)
  assert.equal(readPrepaidTipCents({ tip_cents: 900 }), 0, 'post-trip tip is not a prepaid tip')
  assert.equal(tipBoostOfferLine(1840, 500), '$18.40 incl. $5 tip boost')
  assert.equal(tipBoostOfferLine(1340, 0), null)
})

test('hold amount = fare + 20% buffer + boost + prepaid tip (no buffer on the tip)', async () => {
  assert.equal(holdQuoteCents(10000, 0, 500).authorizationCents, 12500)
  const stripe = scriptedStripe()
  const placed = await placeFareAuthorization({
    stripe, tripId: 't_tip', riderId: 'r1', customerId: 'cus_1', paymentMethodId: 'pm_1',
    backupPaymentMethodIds: [], estimatedFareCents: 10000, boostCents: 1000, prepaidTipCents: 500,
  })
  assert.equal(placed.ok, true)
  assert.equal(stripe.calls[0].params.amount, 13500)
  assert.equal(stripe.calls[0].params.capture_method, 'manual')
  assert.equal(placed.authorization.prepaidTipCents, 500)
})

test('ride request reads the prepaid tip off the trip; credits fare still holds the tip on the card', async () => {
  const sb = tripCompletionDb({ id: 't_req', rider_id: 'r1', metadata: {} }, { profiles: [{ id: 'r1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' }] })
  const stripe = scriptedStripe()
  const res = await authorizeRideRequest({ sb, stripe, trip: { id: 't_req', rider_id: 'r1', fare_cents: 2000, prepaid_tip_cents: 200, metadata: {} } })
  assert.equal(res.ok, true)
  assert.equal(stripe.calls[0].params.amount, 2000 + 400 + 200)

  const stripe2 = scriptedStripe()
  const credits = await authorizeRideRequest({ sb, stripe: stripe2, trip: { id: 't_cr', rider_id: 'r1', fare_cents: 2000, prepaid_tip_cents: 500, metadata: { billing_choice: 'credits' } } })
  assert.notEqual(credits.reason, 'credits')
  assert.equal(stripe2.calls[0].params.amount, 500, 'only the tip is card money when credits cover the fare')
})

function completionSetup({ tip = 500, boost = 0 } = {}) {
  const trip = {
    id: 'tip-trip', rider_id: 'r1', driver_id: 'd1', status: 'in_progress', fare_cents: 4000, prepaid_tip_cents: tip,
    metadata: { boost_cents: boost, prepaid_tip_cents: tip, fare_authorization: { status: 'requires_capture', paymentIntentId: 'pi_hold', authorizationCents: 5300, paymentMethodId: 'pm_card' } },
  }
  const sb = tripCompletionDb(trip, { profiles: [
    { id: 'r1', stripe_customer_id: 'cus_rider', stripe_default_pm_id: 'pm_card' },
    { id: 'd1', stripe_account_id: 'acct_driver' },
  ] })
  const captures = [], transfers = []
  const stripe = {
    paymentIntents: {
      retrieve: async () => ({ id: 'pi_hold', status: 'requires_capture', amount: 5300 }),
      capture: async (id, p) => { captures.push(p.amount_to_capture); return { id, status: 'succeeded', amount_received: p.amount_to_capture } },
      create: async () => assert.fail('no extra charge expected'),
      cancel: async () => assert.fail('no cancel on completion'),
    },
    transfers: { create: async (p) => { transfers.push(p.amount); return { id: 'tr_1' } } },
  }
  return { trip, sb, captures, transfers, complete: () => settleTrip({ sb, stripe, trip, actor: { id: 'd1' }, action: 'complete', payments: sb.tables.payments }) }
}

test('completion captures fare + prepaid tip together and pays 100% of the tip to the driver', async () => {
  const ctx = completionSetup({ tip: 500 })
  const result = await ctx.complete()
  assert.equal(result.http, 200)
  assert.deepEqual(ctx.captures, [4500])
  assert.equal(ctx.sb.tables.payments[0].metadata.prepaid_tip_billed_cents, 500)
  // fare net 3200 (80%) + full 500 tip
  assert.deepEqual(ctx.transfers, [3700])
  assert.equal(result.body.payout.prepaidTipCents, 500)
  const replay = await ctx.complete()
  assert.equal(replay.body.idempotent, true)
  assert.equal(ctx.captures.length, 1)
})

test('cancel releases the whole hold including the prepaid tip', async () => {
  const trip = { id: 't_c', rider_id: 'r1', status: 'canceled', fare_cents: 2000, prepaid_tip_cents: 500,
    metadata: { prepaid_tip_cents: 500, fare_authorization: { status: 'requires_capture', paymentIntentId: 'pi_tip', authorizationCents: 2900, prepaidTipCents: 500 } } }
  const sb = tripCompletionDb(trip)
  const stripe = scriptedStripe()
  const released = await releaseOpenFareHold({ sb, stripe, trip })
  assert.equal(released.released, true)
  assert.deepEqual(stripe.calls, [{ op: 'cancel', id: 'pi_tip' }])
  const ledger = buildPayoutRecord({ ...trip, driver_id: 'd1' })
  assert.equal(ledger.amountCents, 0, 'no tip paid on a canceled ride')
})

test('ledger: prepaid tip passes through at 100%, post-trip tip_cents untouched', () => {
  const trip = { id: 't', driver_id: 'd1', status: 'completed', fare_cents: 4000, prepaid_tip_cents: 1000, tip_cents: 300, metadata: {} }
  const earned = driverTripEarnings(trip)
  assert.equal(earned.prepaidTipCents, 1000)
  assert.equal(earned.tipCents, 300)
  assert.equal(earned.netCents, earned.fareNetCents + 1000)
  const record = buildPayoutRecord(trip)
  assert.equal(record.prepaidTipCents, 1000)
  assert.equal(record.amountCents, earned.fareNetCents + 1000)
})

test('driver gauge counts the prepaid tip', () => {
  const card = { fareCents: 1500, driverNetCents: 1200, routeDurationS: 1800, prepaidTipCents: 500 }
  const without = offerCardGauge({ ...card, prepaidTipCents: 0 })
  const withTip = offerCardGauge(card)
  assert.ok(withTip.hourly > without.hourly)
  assert.equal(Math.round(withTip.hourly - without.hourly), 10, '$5 over 30 min = +$10/hr')
})
