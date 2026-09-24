import assert from 'node:assert/strict'
import test from 'node:test'
import { cardDepositCents } from '../src/lib/fareRates.js'
import { memoryCreditStore } from './credits.js'
import { collectPayment } from './collectPayment.js'
import { quoteAirportCheckout } from './authoritativeFare.js'
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

function fareDb(initial, user) {
  let trip = { ...initial, metadata: { ...(initial.metadata || {}) } }
  const patches = []
  function from(table) {
    const state = { table, op: 'select', patch: null, filters: [] }
    const api = {
      select() { return api },
      insert(row) { state.op = 'insert'; state.patch = row; return api },
      update(row) { state.op = 'update'; state.patch = row; return api },
      upsert(row) { state.op = 'upsert'; state.patch = row; return api },
      eq(col, val) { state.filters.push([col, val]); return api },
      is(col, val) { state.filters.push([col, val]); return api },
      lte() { return api },
      gte() { return api },
      order() { return api },
      limit() { return api },
      maybeSingle() { return Promise.resolve(apply(state, true)) },
      single() { return Promise.resolve(apply(state, true)) },
      then(resolve, reject) { return Promise.resolve(apply(state, false)).then(resolve, reject) },
    }
    return api
  }
  function apply(state, single) {
    if (state.table === 'game_day_events') return { data: [], error: null }
    if (state.table !== 'trips') return { data: null, error: null }
    if (state.op === 'update') {
      const guarded = state.filters.some(([col, val]) => col === 'fare_cents' && val == null)
      if (guarded && trip.fare_cents != null) return { data: null, error: null }
      trip = {
        ...trip,
        ...state.patch,
        metadata: state.patch.metadata || trip.metadata,
      }
      patches.push(state.patch)
      return { data: single ? trip : null, error: null }
    }
    return { data: single ? trip : [trip], error: null }
  }
  return {
    from,
    patches: () => patches,
    trip: () => trip,
    auth: { admin: { getUserById: async () => ({ data: { user }, error: null }) } },
  }
}

test('a completed null-fare airport trip is priced before it can settle', async () => {
  const when = '2026-09-23T15:00:00.000Z'
  const h = ioHarness({ balance: 0, hasCard: true })
  const refused = await settleTrip({
    trip: {
      id: 'trip_null',
      rider_id: 'rider',
      driver_id: 'driver',
      status: 'in_progress',
      fare_cents: null,
      pickup_label: 'Memorial Stadium',
      dropoff_label: 'GSP Airport',
      metadata: { isStudent: true },
    },
    payments: [],
    action: 'complete',
    deps: h.deps,
  })
  assert.equal(refused.http, 409)
  assert.equal(refused.body.code, 'fare_not_set')
  assert.equal(refused.body.progressed, false)
  assert.equal(h.intents.length, 0)

  const bare = fareDb({
    id: 'trip_bare',
    rider_id: 'rider',
    driver_id: 'driver',
    status: 'in_progress',
    fare_cents: null,
    pickup_label: '',
    dropoff_label: '',
    requested_at: when,
    metadata: {},
  }, { id: 'rider', email: 'spoof@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z' })
  const unpriced = await settleTrip({
    sb: bare,
    trip: bare.trip(),
    payments: [],
    action: 'complete',
    deps: h.deps,
  })
  assert.equal(unpriced.http, 409)
  assert.equal(unpriced.body.code, 'fare_not_set')
  assert.equal(unpriced.body.progressed, false)
  assert.equal(bare.trip().fare_cents, null)
  assert.equal(h.intents.length, 0)

  const gmail = { id: 'rider', email: 'spoof@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z', student_verified_at: '2026-01-01T00:00:00Z' }
  const db = fareDb({
    id: 'trip_gsp',
    rider_id: 'rider',
    driver_id: 'driver',
    status: 'in_progress',
    fare_cents: null,
    deposit_cents: null,
    tier: 'standard',
    pickup_label: 'Memorial Stadium',
    dropoff_label: 'GSP Airport',
    pickup_lat: 34.6788,
    pickup_lng: -82.843,
    dropoff_lat: 34.6788,
    dropoff_lng: -82.843,
    requested_at: when,
    metadata: { isStudent: true },
  }, gmail)
  const settled = await settleTrip({
    sb: db,
    trip: db.trip(),
    payments: [],
    action: 'complete',
    deps: h.deps,
  })
  const full = quoteAirportCheckout({ airport: 'GSP', at: new Date(when), isStudent: false })
  assert.equal(settled.http, 200)
  assert.equal(settled.body.progressed, true)
  assert.equal(db.trip().fare_cents, full.fareCents)
  assert.equal(db.trip().deposit_cents, cardDepositCents(full.fareCents))
  assert.equal(db.trip().metadata.isStudent, false)
  assert.equal(db.trip().metadata.fare_source, 'server')
  assert.equal(h.intents.at(-1).amount, full.fareCents)
  assert.ok(full.fareCents > 0)
})

test('a confirmed Clemson rider gets 10% off when a null fare is filled at settle', async () => {
  const when = '2026-09-23T15:00:00.000Z'
  const h = ioHarness({ balance: 0, hasCard: true })
  const tiger = { id: 'rider', email: 'tiger@g.clemson.edu', email_confirmed_at: '2026-01-01T00:00:00Z' }
  const db = fareDb({
    id: 'trip_student',
    rider_id: 'rider',
    driver_id: 'driver',
    status: 'in_progress',
    fare_cents: null,
    tier: 'standard',
    pickup_label: 'Memorial Stadium',
    dropoff_label: 'CLT Airport',
    pickup_lat: 34.6788,
    pickup_lng: -82.843,
    dropoff_lat: 34.679,
    dropoff_lng: -82.84,
    requested_at: when,
    metadata: {},
  }, tiger)
  const settled = await settleTrip({
    sb: db,
    trip: { id: 'trip_student', rider_id: 'rider', driver_id: 'driver', status: 'in_progress', fare_cents: null, metadata: {} },
    payments: [],
    action: 'complete',
    deps: h.deps,
  })
  const full = quoteAirportCheckout({ airport: 'CLT', at: new Date(when), isStudent: false })
  const student = quoteAirportCheckout({ airport: 'CLT', at: new Date(when), isStudent: true })
  assert.equal(settled.http, 200)
  assert.equal(db.trip().fare_cents, student.fareCents)
  assert.ok(student.fareCents < full.fareCents)
  assert.equal(db.trip().deposit_cents, cardDepositCents(student.fareCents))
  assert.equal(h.intents.at(-1).amount, student.fareCents)
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
