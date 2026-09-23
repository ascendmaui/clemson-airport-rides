import assert from 'node:assert/strict'
import test from 'node:test'
import { memoryCreditStore } from './credits.js'
import { collectPayment } from './collectPayment.js'
import { settleTrip } from './tripSettle.js'
import { attemptDriverPayout } from './payouts.js'

function ioHarness({ balance = 0, hasCard = true } = {}) {
  const credits = memoryCreditStore({ rider: balance })
  const payments = []
  const holds = []
  const intents = []
  let profile = hasCard
    ? { id: 'rider', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1', email: 'rider@clemson.edu' }
    : { id: 'rider', stripe_customer_id: null, stripe_default_pm_id: null, email: 'rider@clemson.edu' }
  return {
    credits,
    payments,
    holds,
    intents,
    setCard(on) {
      profile = on
        ? { ...profile, stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' }
        : { ...profile, stripe_customer_id: null, stripe_default_pm_id: null }
    },
    deps: {
      getCredits: (userId) => credits.getCredits(userId),
      applyCredits: (userId, delta, meta) => credits.applyCredits(userId, delta, meta),
      insertPayment: async (row) => {
        const id = `pay_${payments.length + 1}`
        payments.push({ ...row, id })
        return { id }
      },
      findPayment: async (key) => payments.find((row) => row.idempotency_key === key && row.status === 'succeeded') || null,
      setHold: async (tripId, failure) => { holds.push({ tripId, failure }) },
      clearHold: async (tripId) => { holds.push({ tripId, cleared: true }) },
      loadProfile: async () => profile,
      createPaymentIntent: async (params) => {
        intents.push(params)
        if (params.payment_method === 'pm_expired') {
          const err = new Error('Your card has expired.')
          err.code = 'expired_card'
          err.decline_code = 'expired_card'
          throw err
        }
        if (params.payment_method === 'pm_funds') {
          const err = new Error('Insufficient funds')
          err.code = 'card_declined'
          err.decline_code = 'insufficient_funds'
          throw err
        }
        if (params.payment_method === 'pm_removed') {
          const err = new Error('No such payment_method: detached')
          err.code = 'resource_missing'
          throw err
        }
        if (params.payment_method === 'pm_declined') {
          const err = new Error('Your card was declined.')
          err.code = 'card_declined'
          throw err
        }
        return { id: `pi_${intents.length}`, status: 'succeeded', amount: params.amount }
      },
    },
  }
}

test('full credits pay without touching the card', async () => {
  const h = ioHarness({ balance: 2500 })
  const result = await collectPayment({
    deps: h.deps,
    tripId: 'trip_1',
    riderId: 'rider',
    amountCents: 2500,
    idempotencyKey: 'fare-1',
  })
  assert.equal(result.ok, true)
  assert.equal(result.method, 'credits')
  assert.equal(result.cardChargedCents, 0)
  assert.equal(h.intents.length, 0)
  assert.equal((await h.credits.getCredits('rider')).balanceCents, 0)
})

test('short credits fall back to the default card', async () => {
  const h = ioHarness({ balance: 400, hasCard: true })
  const result = await collectPayment({
    deps: h.deps,
    tripId: 'trip_1',
    riderId: 'rider',
    amountCents: 1000,
    idempotencyKey: 'fare-2',
  })
  assert.equal(result.ok, true)
  assert.equal(result.method, 'credits+card')
  assert.equal(result.creditsAppliedCents, 400)
  assert.equal(result.cardChargedCents, 600)
  assert.equal(h.intents[0].amount, 600)
  assert.equal(h.intents[0].off_session, true)
})

test('insufficient credits and no card never succeed silently', async () => {
  const h = ioHarness({ balance: 100, hasCard: false })
  const result = await collectPayment({
    deps: h.deps,
    tripId: 'trip_1',
    riderId: 'rider',
    amountCents: 900,
    methods: ['credits'],
    idempotencyKey: 'fare-3',
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 'payment_required')
  assert.equal(result.code, 'credits_insufficient')
  assert.equal((await h.credits.getCredits('rider')).balanceCents, 100)
  assert.equal(h.holds.at(-1).failure.code, 'credits_insufficient')
})

test('expired card, insufficient funds, removed card, and decline hold the trip', async () => {
  const cases = [
    ['pm_expired', 'expired_card'],
    ['pm_funds', 'insufficient_funds'],
    ['pm_removed', 'card_removed'],
    ['pm_declined', 'card_declined'],
  ]
  for (const [pm, code] of cases) {
    const h = ioHarness({ balance: 0, hasCard: true })
    h.deps.loadProfile = async () => ({ stripe_customer_id: 'cus_1', stripe_default_pm_id: pm })
    const result = await collectPayment({
      deps: h.deps,
      tripId: 'trip_card',
      riderId: 'rider',
      amountCents: 3200,
      idempotencyKey: `card-${pm}`,
      midRide: true,
    })
    assert.equal(result.ok, false, code)
    assert.equal(result.code, code)
    assert.equal(result.status, 'payment_required')
    assert.ok(result.alternatives.includes('add_card'))
    assert.match(result.message, /card|Card|funds|removed|declined/i)
  }
})

test('card removed mid-ride rolls back credits that were applied', async () => {
  const h = ioHarness({ balance: 700, hasCard: true })
  h.deps.loadProfile = async () => ({ stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_removed' })
  const result = await collectPayment({
    deps: h.deps,
    tripId: 'trip_mid',
    riderId: 'rider',
    amountCents: 2000,
    idempotencyKey: 'mid-removed',
    midRide: true,
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'card_removed')
  assert.equal(result.creditsReleased, true)
  assert.equal((await h.credits.getCredits('rider')).balanceCents, 700)
  assert.equal(h.holds.at(-1).failure.status, 'payment_required')
})

test('credits exhausted mid-ride fall back onto the card', async () => {
  const h = ioHarness({ balance: 0, hasCard: true })
  const result = await collectPayment({
    deps: h.deps,
    tripId: 'trip_mid',
    riderId: 'rider',
    amountCents: 1500,
    idempotencyKey: 'mid-empty-credits',
    midRide: true,
  })
  assert.equal(result.ok, true)
  assert.equal(result.method, 'card')
  assert.equal(result.cardChargedCents, 1500)
})

test('$0 charge succeeds and a failed charge blocks complete', async () => {
  const zero = ioHarness()
  const free = await collectPayment({
    deps: zero.deps,
    tripId: 'trip_free',
    riderId: 'rider',
    amountCents: 0,
    idempotencyKey: 'zero',
  })
  assert.equal(free.ok, true)
  assert.equal(free.zero, true)
  assert.equal(zero.intents.length, 0)

  const h = ioHarness({ balance: 0, hasCard: true })
  h.deps.loadProfile = async () => ({ stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_declined' })
  const trip = {
    id: 'trip_block',
    rider_id: 'rider',
    driver_id: 'driver',
    status: 'in_progress',
    fare_cents: 4000,
    metadata: {},
  }
  const blocked = await settleTrip({
    trip,
    payments: [],
    action: 'complete',
    deps: h.deps,
  })
  assert.equal(blocked.http, 402)
  assert.equal(blocked.body.progressed, false)
  assert.equal(blocked.body.status, 'payment_required')
  assert.equal(blocked.body.failure.code, 'card_declined')

  const open = await settleTrip({
    trip: { ...trip, fare_cents: 0 },
    payments: [],
    action: 'complete',
    deps: h.deps,
  })
  assert.equal(open.http, 200)
  assert.equal(open.body.progressed, true)
  assert.equal(open.body.reason, 'zero_due')
  assert.equal(open.body.status, 'completed')
})

test('cancel with a precomputed fee does not complete when the card is declined', async () => {
  const h = ioHarness({ balance: 0, hasCard: true })
  h.deps.loadProfile = async () => ({ stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_funds' })
  const settled = await settleTrip({
    trip: {
      id: 'trip_cancel',
      rider_id: 'rider',
      driver_id: 'driver',
      status: 'in_progress',
      fare_cents: 8000,
      metadata: { cancel_fee_cents: 1500 },
    },
    action: 'cancel',
    feeKind: 'cancel_fee',
    deps: h.deps,
  })
  assert.equal(settled.http, 402)
  assert.equal(settled.body.progressed, false)
  assert.equal(settled.body.failure.code, 'insufficient_funds')
  assert.notEqual(settled.body.status, 'canceled')
})

test('payout failure is logged as pending and a later attempt can pay', async () => {
  const trip = { id: 'trip_p', driver_id: 'driver', fare_cents: 10000, metadata: {} }
  const failed = await attemptDriverPayout({ trip, stripe: null, connectAccountId: null, now: 5_000 })
  assert.equal(failed.ok, false)
  assert.equal(failed.payout.status, 'pending')
  assert.equal(failed.payout.amountCents, 8000)
  const stripe = {
    transfers: {
      create: async (params) => ({ id: 'tr_ok', amount: params.amount }),
    },
  }
  const paid = await attemptDriverPayout({
    trip: { ...trip, metadata: { payout: { ...failed.payout, nextRetryAt: new Date(0).toISOString() } } },
    stripe,
    connectAccountId: 'acct_1',
    now: Date.now() + 60_000,
  })
  assert.equal(paid.ok, true)
  assert.equal(paid.payout.status, 'paid')
  assert.equal(paid.payout.stripeTransferId, 'tr_ok')
})
