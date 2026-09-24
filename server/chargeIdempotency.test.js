import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { chargeFriendShare } from './chargeFriendShare.js'
import {
  cardIntentKey,
  creditsIntentKey,
  friendShareChargeKey,
  tripChargeKey,
  waitChargeKey,
} from './chargeIdempotency.js'
import { settleTrip } from './tripSettle.js'

const RIDE_ID = 'ride_1'
const USER_ID = 'user_1'
const FARE_A = 1800
const FARE_B = 1860

function memoryStripe() {
  const intents = new Map()
  const creates = []
  const updates = []
  let n = 0
  return {
    intents,
    creates,
    updates,
    paymentIntents: {
      async create(params, options) {
        n += 1
        const pi = {
          id: `pi_${n}`,
          amount: params.amount,
          status: 'requires_action',
          client_secret: `secret_${n}`,
        }
        intents.set(pi.id, pi)
        creates.push({ params, options, id: pi.id })
        return { ...pi }
      },
      async retrieve(id) {
        const pi = intents.get(id)
        if (!pi) throw Object.assign(new Error(`No such payment_intent: ${id}`), { code: 'resource_missing' })
        return { ...pi }
      },
      async update(id, params) {
        const pi = intents.get(id)
        if (!pi) throw new Error(`missing ${id}`)
        if (params.amount != null) pi.amount = params.amount
        updates.push({ id, params })
        return { ...pi }
      },
    },
  }
}

function memorySb({ profile, participant, payments: seed = [] }) {
  const payments = seed.map((row) => ({ ...row }))
  const participants = new Map([[participant.id, { ...participant }]])
  function from(table) {
    const state = { op: 'select', payload: null, filters: {} }
    const api = {
      select() { return api },
      insert(row) { state.op = 'insert'; state.payload = row; return api },
      update(row) { state.op = 'update'; state.payload = row; return api },
      eq(col, val) { state.filters[col] = val; return api },
      maybeSingle() { return Promise.resolve(run()) },
      single() { return Promise.resolve(run()) },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
    }
    function run() {
      if (table === 'credit_accounts' || table === 'friend_rides' || table === 'trips') {
        return { data: null, error: null }
      }
      if (table === 'profiles') return { data: profile, error: null }
      if (table === 'friend_ride_participants') {
        if (state.op === 'update') {
          const prev = participants.get(state.filters.id) || {}
          participants.set(state.filters.id, { ...prev, ...state.payload })
        }
        return { data: participants.get(state.filters.id) || null, error: null }
      }
      if (table === 'payments') {
        if (state.op === 'insert') {
          const id = `pay_${payments.length + 1}`
          payments.push({ ...state.payload, id })
          return { data: { id }, error: null }
        }
        if (state.op === 'update') {
          const row = payments.find((item) => item.id === state.filters.id)
            || payments.find((item) => item.idempotency_key === state.filters.idempotency_key)
          if (row) Object.assign(row, state.payload)
          return { data: null, error: null }
        }
        const key = state.filters.idempotency_key
        const row = key ? payments.find((item) => item.idempotency_key === key) || null : null
        return { data: row, error: null }
      }
      return { data: null, error: null }
    }
    return api
  }
  return { from, payments, participants }
}

function rider() {
  return {
    id: USER_ID,
    email: 'ada@g.clemson.edu',
    full_name: 'Ada',
    stripe_customer_id: 'cus_1',
    stripe_default_pm_id: 'pm_1',
  }
}

function participant(extra = {}) {
  return {
    id: 'part_1',
    user_id: USER_ID,
    friend_ride_id: RIDE_ID,
    fare_cents: FARE_A,
    status: 'joined',
    display_name: 'Ada',
    email: 'ada@g.clemson.edu',
    charge_attempts: 0,
    ...extra,
  }
}

const ride = { id: RIDE_ID, token: 'tok', trip_id: null }

test('friend share charge key has no amount and stays the same when the fare changes', () => {
  const key = friendShareChargeKey(RIDE_ID, USER_ID)
  assert.equal(key, 'friend_share:ride_1:user_1:charge')
  assert.equal(friendShareChargeKey(RIDE_ID, USER_ID), key)
  assert.equal(cardIntentKey(key), 'friend_share:ride_1:user_1:charge:card')
  assert.equal(creditsIntentKey(key), 'friend_share:ride_1:user_1:charge:credits')
  assert.doesNotMatch(key, new RegExp(`${FARE_A}|${FARE_B}`))
  assert.doesNotMatch(cardIntentKey(key), new RegExp(`${FARE_A}|${FARE_B}`))
  assert.equal(tripChargeKey('trip_1', USER_ID, 'balance', 0), 'trip:trip_1:user_1:balance:paid0:charge')
  assert.equal(tripChargeKey('trip_1', USER_ID, 'balance', 4000), 'trip:trip_1:user_1:balance:paid4000:charge')
  assert.equal(tripChargeKey('trip_1', USER_ID, 'balance:admin', 4000), 'trip:trip_1:user_1:balance:admin:paid4000:charge')
  assert.equal(waitChargeKey('trip_1', USER_ID), 'wait:trip_1:user_1:charge')
  for (const file of ['chargeFriendShare.js', 'tripSettle.js', 'tripWait.js', 'endpoints/collectPayment.js']) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /friend:\$\{ride\.id\}:\$\{p\.id\}:\$\{p\.fare_cents\}/)
    assert.doesNotMatch(src, /clemson-wait-\$\{trip\.id\}-\$\{waitFee\}/)
    assert.doesNotMatch(src, /\$\{trip\.id\}:\$\{chargeKind\}:\$\{due\.amountCents\}/)
    assert.doesNotMatch(src, /\$\{trip\.id\}:\$\{kind\}:\$\{amountCents\}/)
  }
})

test('a requires_action retry with a new fare reuses the PaymentIntent', async () => {
  const stripe = memoryStripe()
  const firstParticipant = participant({ fare_cents: FARE_A })
  const sb = memorySb({ profile: rider(), participant: firstParticipant })
  const first = await chargeFriendShare({
    sb,
    stripe,
    ride,
    participant: firstParticipant,
    methods: ['card'],
  })
  assert.equal(first.result.status, 'requires_action')
  assert.equal(stripe.creates.length, 1)
  const key = friendShareChargeKey(RIDE_ID, USER_ID)
  assert.equal(stripe.creates[0].options.idempotencyKey, cardIntentKey(key))
  assert.equal(stripe.creates[0].params.amount, FARE_A)
  assert.doesNotMatch(stripe.creates[0].options.idempotencyKey, new RegExp(`${FARE_A}|${FARE_B}`))

  const second = await chargeFriendShare({
    sb,
    stripe,
    ride,
    participant: participant({ fare_cents: FARE_B }),
    methods: ['card'],
  })
  assert.equal(second.result.status, 'requires_action')
  assert.equal(second.result.paymentIntentId, first.result.paymentIntentId)
  assert.equal(stripe.creates.length, 1)
  assert.equal(stripe.updates.length, 1)
  assert.equal(stripe.updates[0].params.amount, FARE_B)
  assert.equal(stripe.intents.get(first.result.paymentIntentId).amount, FARE_B)
  assert.equal(second.paymentElement.clientSecret, 'secret_1')
})

test('a succeeded PaymentIntent is not charged again', async () => {
  const stripe = memoryStripe()
  stripe.intents.set('pi_paid', {
    id: 'pi_paid',
    status: 'succeeded',
    amount: FARE_A,
    client_secret: 'secret_paid',
  })
  const sb = memorySb({
    profile: rider(),
    participant: participant({ fare_cents: FARE_B, stripe_payment_intent_id: 'pi_paid' }),
  })
  const result = await chargeFriendShare({
    sb,
    stripe,
    ride,
    participant: participant({ fare_cents: FARE_B, stripe_payment_intent_id: 'pi_paid' }),
    methods: ['card'],
  })
  assert.equal(result.result.status, 'paid')
  assert.equal(result.result.paymentIntentId, 'pi_paid')
  assert.equal(stripe.creates.length, 0)
  assert.equal(stripe.updates.length, 0)
})

test('a canceled PaymentIntent is replaced with an attempt suffix and no amount in the key', async () => {
  const stripe = memoryStripe()
  stripe.intents.set('pi_canceled', {
    id: 'pi_canceled',
    status: 'canceled',
    amount: FARE_A,
    client_secret: null,
  })
  const sb = memorySb({
    profile: rider(),
    participant: participant({ stripe_payment_intent_id: 'pi_canceled' }),
  })
  const result = await chargeFriendShare({
    sb,
    stripe,
    ride,
    participant: participant({ fare_cents: FARE_B, stripe_payment_intent_id: 'pi_canceled' }),
    methods: ['card'],
  })
  assert.equal(stripe.creates.length, 1)
  assert.equal(stripe.creates[0].params.amount, FARE_B)
  assert.equal(
    stripe.creates[0].options.idempotencyKey,
    cardIntentKey(friendShareChargeKey(RIDE_ID, USER_ID), 'attempt:pi_canceled'),
  )
  assert.doesNotMatch(stripe.creates[0].options.idempotencyKey, new RegExp(`${FARE_A}|${FARE_B}`))
  assert.equal(result.result.paymentIntentId, 'pi_1')
})

test('a canceled friend-share PaymentIntent can be charged again', async () => {
  const stripe = memoryStripe()
  stripe.intents.set('pi_old', {
    id: 'pi_old',
    status: 'canceled',
    amount: FARE_A,
    client_secret: null,
  })
  const key = friendShareChargeKey(RIDE_ID, USER_ID)
  const sb = memorySb({
    profile: rider(),
    participant: participant({ stripe_payment_intent_id: 'pi_old' }),
    payments: [{
      id: 'pay_old',
      idempotency_key: key,
      status: 'succeeded',
      stripe_payment_intent_id: 'pi_old',
      amount_cents: FARE_A,
      kind: 'friend_ride_share',
      rider_id: USER_ID,
    }],
  })
  const result = await chargeFriendShare({
    sb,
    stripe,
    ride,
    participant: participant({ fare_cents: FARE_B, stripe_payment_intent_id: 'pi_old' }),
    methods: ['card'],
  })
  assert.equal(stripe.creates.length, 1)
  assert.equal(
    stripe.creates[0].options.idempotencyKey,
    cardIntentKey(key, 'attempt:pi_old'),
  )
  assert.equal(result.result.paymentIntentId, 'pi_1')
  assert.notEqual(result.result.status, 'paid')
})

function settleHarness(piStatus) {
  const payments = []
  const creates = []
  const updates = []
  const intents = new Map()
  let n = 0
  const deps = {
    getCredits: async () => ({ balanceCents: 0, unavailable: true }),
    applyCredits: async () => ({ ok: true, balanceCents: 0 }),
    insertPayment: async (row) => {
      const existing = payments.find((item) => item.idempotency_key && item.idempotency_key === row.idempotency_key)
      if (existing) {
        const samePi = !row.stripe_payment_intent_id || row.stripe_payment_intent_id === existing.stripe_payment_intent_id
        if (existing.status === 'succeeded' && row.status !== 'succeeded' && samePi) return { id: existing.id }
        Object.assign(existing, row)
        return { id: existing.id }
      }
      const id = `pay_${payments.length + 1}`
      payments.push({ ...row, id })
      return { id }
    },
    findPayment: async (key) => {
      const row = payments.find((item) => item.idempotency_key === key && item.status === 'succeeded')
      if (!row) return null
      return {
        id: row.id,
        status: row.status,
        amountCents: row.amount_cents,
        paymentIntentId: row.stripe_payment_intent_id,
      }
    },
    findPaymentIntent: async (key) => {
      const row = payments.find((item) => item.idempotency_key === key && String(item.stripe_payment_intent_id || '').startsWith('pi_'))
      if (!row) return null
      return { id: row.id, status: row.status, paymentIntentId: row.stripe_payment_intent_id }
    },
    setHold: async () => {},
    clearHold: async () => {},
    loadProfile: async () => rider(),
    retrievePaymentIntent: async (id) => {
      const pi = intents.get(id)
      if (!pi) throw new Error(`missing ${id}`)
      return { ...pi }
    },
    updatePaymentIntent: async (id, params) => {
      const pi = intents.get(id)
      if (!pi) throw new Error(`missing ${id}`)
      if (params.amount != null) pi.amount = params.amount
      updates.push({ id, params })
      return { ...pi }
    },
    createPaymentIntent: async (params, options) => {
      n += 1
      const pi = { id: `pi_${n}`, amount: params.amount, status: piStatus, client_secret: `secret_${n}` }
      intents.set(pi.id, pi)
      creates.push({ params, options, id: pi.id })
      return { ...pi }
    },
  }
  return { deps, payments, creates, updates, intents }
}

test('trip settle keeps one card charge when the fare changes before anything is marked paid', async () => {
  const payments = []
  const creates = []
  const deps = {
    getCredits: async () => ({ balanceCents: 0, unavailable: true }),
    applyCredits: async () => ({ ok: true, balanceCents: 0 }),
    insertPayment: async (row) => {
      const id = `pay_${payments.length + 1}`
      payments.push({ ...row, id })
      return { id }
    },
    findPayment: async (key) => payments.find((row) => row.idempotency_key === key && row.status === 'succeeded') || null,
    setHold: async () => {},
    clearHold: async () => {},
    loadProfile: async () => rider(),
    createPaymentIntent: async (params, options) => {
      creates.push({ params, options })
      return { id: `pi_${creates.length}`, status: 'succeeded', amount: params.amount }
    },
  }
  const trip = {
    id: 'trip_settle',
    rider_id: USER_ID,
    status: 'in_progress',
    fare_cents: FARE_A,
    metadata: {},
  }
  const first = await settleTrip({ trip, payments: [], action: 'complete', deps })
  assert.equal(first.http, 200)
  assert.equal(creates.length, 1)
  const key = cardIntentKey(tripChargeKey(trip.id, USER_ID, 'balance'))
  assert.equal(creates[0].options.idempotencyKey, key)
  assert.doesNotMatch(key, new RegExp(`${FARE_A}|${FARE_B}`))

  const second = await settleTrip({
    trip: { ...trip, fare_cents: FARE_B },
    payments: [],
    action: 'complete',
    deps,
  })
  assert.equal(second.http, 200)
  assert.equal(second.body.payment.idempotent, true)
  assert.equal(creates.length, 1)
})

test('a fare drift during requires_action reuses the trip balance PaymentIntent', async () => {
  const h = settleHarness('requires_action')
  const trip = {
    id: 'trip_open',
    rider_id: USER_ID,
    status: 'in_progress',
    fare_cents: FARE_A,
    metadata: { fare_paid_cents: 0 },
  }
  const first = await settleTrip({ trip, payments: [], action: 'complete', deps: h.deps })
  assert.equal(first.http, 402)
  assert.equal(h.creates.length, 1)
  const key = cardIntentKey(tripChargeKey(trip.id, USER_ID, 'balance', 0))
  assert.equal(h.creates[0].options.idempotencyKey, key)
  assert.equal(h.creates[0].params.amount, FARE_A)
  assert.doesNotMatch(key, new RegExp(`${FARE_A}|${FARE_B}`))

  const second = await settleTrip({
    trip: { ...trip, fare_cents: FARE_B },
    payments: [],
    action: 'complete',
    deps: h.deps,
  })
  assert.equal(second.http, 402)
  assert.equal(second.body.failure.paymentIntentId, h.creates[0].id)
  assert.equal(h.creates.length, 1)
  assert.equal(h.updates.length, 1)
  assert.equal(h.updates[0].params.amount, FARE_B)
  assert.equal(h.intents.get(h.creates[0].id).amount, FARE_B)
})

test('a later balance due after fare_paid_cents moves is a new charge', async () => {
  const h = settleHarness('succeeded')
  const trip = {
    id: 'trip_bal',
    rider_id: USER_ID,
    status: 'in_progress',
    fare_cents: 4000,
    metadata: { fare_paid_cents: 0 },
  }
  const first = await settleTrip({ trip, payments: [], action: 'complete', deps: h.deps })
  assert.equal(first.http, 200)
  assert.equal(h.creates.length, 1)
  assert.equal(h.creates[0].params.amount, 4000)
  const firstKey = cardIntentKey(tripChargeKey(trip.id, USER_ID, 'balance', 0))
  assert.equal(h.creates[0].options.idempotencyKey, firstKey)

  const second = await settleTrip({
    trip: { ...trip, fare_cents: 5500, metadata: { fare_paid_cents: 4000 } },
    payments: [],
    action: 'complete',
    deps: h.deps,
  })
  assert.equal(second.http, 200)
  assert.equal(second.body.payment.idempotent, undefined)
  assert.equal(h.creates.length, 2)
  assert.equal(h.creates[1].params.amount, 1500)
  const secondKey = cardIntentKey(tripChargeKey(trip.id, USER_ID, 'balance', 4000))
  assert.equal(h.creates[1].options.idempotencyKey, secondKey)
  assert.notEqual(firstKey, secondKey)
  assert.doesNotMatch(secondKey, /5500|1500/)
  assert.match(secondKey, /:paid4000:charge:card$/)
})
