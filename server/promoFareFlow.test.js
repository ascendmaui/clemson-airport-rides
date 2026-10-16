/**
 * Promo money path: the hold and the capture drop by the code's discount,
 * the driver payout does not. See shared/promoCodes.js (money rules).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizeRideRequest } from './fareAuthorization.js'
import { settleTrip as settleTripService } from './tripSettle.js'
import { tripCompletionDb } from '../tests/fixtures/tripCompletionDb.js'
import { promoTripSnapshot } from '../shared/promoCodes.js'

function memoryDb(seed = {}) {
  const tables = {
    profiles: [...(seed.profiles || [])],
    trips: [...(seed.trips || [])],
    payments: [...(seed.payments || [])],
  }

  function from(table) {
    if (!tables[table]) tables[table] = []
    const rows = tables[table]
    const state = { op: 'select', filters: [], payload: null }

    function run(one) {
      const matches = (row) => state.filters.every(([col, val]) => row[col] === val)
      if (state.op === 'insert') {
        const row = { id: state.payload.id || `${table}_${rows.length + 1}`, ...state.payload }
        rows.push(row)
        return { data: one ? { ...row } : [{ ...row }], error: null }
      }
      if (state.op === 'update') {
        const matched = rows.filter(matches)
        for (const row of matched) Object.assign(row, state.payload)
        return { data: matched.map((row) => ({ ...row })), error: null }
      }
      const found = rows.filter(matches)
      if (one) return { data: found[0] ? { ...found[0] } : null, error: null }
      return { data: found.map((row) => ({ ...row })), error: null }
    }

    const api = {
      select() { return api },
      insert(payload) { state.op = 'insert'; state.payload = payload; return api },
      update(payload) { state.op = 'update'; state.payload = payload; return api },
      eq(col, val) { state.filters.push([col, val]); return api },
      maybeSingle() { return Promise.resolve(run(true)) },
      single() { return Promise.resolve(run(true)) },
      then(resolve, reject) { return Promise.resolve(run(false)).then(resolve, reject) },
    }
    return api
  }

  return { tables, from }
}


function scriptedStripe({ creates = [], methods = [], capture, increment, retrieve } = {}) {
  const calls = []
  let cursor = 0
  return {
    calls,
    paymentMethods: {
      async list() {
        return { data: methods.map((id) => ({ id })) }
      },
    },
    paymentIntents: {
      async create(params, options) {
        calls.push({ op: 'create', params, options })
        const step = creates[cursor] || creates[creates.length - 1]
        cursor += 1
        if (step?.error) throw step.error
        return {
          id: step?.id || `pi_${cursor}`,
          status: step?.status || 'requires_capture',
          amount: params.amount,
          amount_received: step?.status === 'succeeded' ? params.amount : 0,
          ...(step?.last_payment_error ? { last_payment_error: step.last_payment_error } : {}),
        }
      },
      async cancel(id) {
        calls.push({ op: 'cancel', id })
        return { id, status: 'canceled' }
      },
      async retrieve(id) {
        calls.push({ op: 'retrieve', id })
        if (retrieve) return retrieve(id)
        return { id, status: 'requires_capture', amount: 12000 }
      },
      async capture(id, params, options) {
        calls.push({ op: 'capture', id, params, options })
        if (!capture) return { id, status: 'succeeded', amount_received: params.amount_to_capture }
        const result = typeof capture === 'function' ? capture(id, params, options) : capture
        if (result?.error) throw result.error
        return result
      },
      async incrementAuthorization(id, params, options) {
        calls.push({ op: 'increment', id, params, options })
        if (!increment) return { id, status: 'requires_capture', amount: params.amount }
        if (increment.error) throw increment.error
        return increment
      },
    },
  }
}


function makeMockSb({
  tripData = null,
  profileData = null,
  tripUpdateError = null,
  eventInsertError = null,
  connectAccountId = null,
} = {}) {
  const db = tripCompletionDb(tripData, { updateError: tripUpdateError })
  const updates = db.updates
  const events = []
  const payouts = []

  return {
    seedTrip: db.seedTrip,
    updates,
    events,
    payouts,
    from(table) {
      if (table === 'profiles') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: profileData ?? (connectAccountId ? { stripe_account_id: connectAccountId } : null),
                    error: null,
                  }),
                }
              },
            }
          },
        }
      }
      if (table === 'trips') return db.from(table)
      if (table === 'trip_events') {
        return {
          insert(row) {
            events.push(row)
            return Promise.resolve({ data: eventInsertError ? null : row, error: eventInsertError })
          },
        }
      }
      if (table === 'driver_payouts') {
        return {
          upsert(row) {
            payouts.push(row)
            return Promise.resolve({ data: row, error: null })
          },
        }
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        insert: () => Promise.resolve({ data: null, error: null }),
      }
    },
  }
}

function mockDeps({
  balance = 0,
  cardDeclined = false,
  profile = { stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' },
} = {}) {
  const payments = []
  const holds = []
  return {
    payments,
    holds,
    getCredits: async () => balance,
    applyCredits: async () => ({ balance: 0, applied: balance }),
    insertPayment: async (row) => {
      const id = `pay_${payments.length + 1}`
      payments.push({ ...row, id })
      return { id }
    },
    findPayment: async (key) => payments.find((p) => p.idempotency_key === key) || null,
    setHold: async (tripId, failure) => { holds.push({ tripId, failure }) },
    clearHold: async (tripId) => { holds.push({ tripId, cleared: true }) },
    loadProfile: async () => profile,
    createPaymentIntent: async (params) => {
      if (cardDeclined) {
        const err = new Error('Your card was declined.')
        err.code = 'card_declined'
        err.decline_code = 'generic_decline'
        throw err
      }
      return {
        id: 'pi_test_123',
        status: 'succeeded',
        amount: params.amount,
        currency: params.currency || 'usd',
      }
    },
  }
}


const PROMO = promoTripSnapshot({
  ok: true, redemption_id: 'red_1', code: 'FALL20', code_id: 'code_1', discount_type: 'percent',
  percent_off_bps: 2000, max_discount_cents: 1500, min_trip_cents: 0, discount_cents: 800,
}, { listFareCents: 4000, recurringFareCents: 3600 })

test('card hold is the discounted fare plus the buffer, and Stripe sees the code', async () => {
  const db = memoryDb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_default' }],
    trips: [{ id: 'trip_promo', rider_id: 'rider_1', fare_cents: 4000, metadata: { promo: PROMO } }],
  })
  const stripe = scriptedStripe({ creates: [{ id: 'pi_promo', status: 'requires_capture' }] })
  const placed = await authorizeRideRequest({ sb: db, stripe, trip: db.tables.trips[0] })
  assert.equal(placed.ok, true)
  const create = stripe.calls.find((call) => call.op === 'create')
  // 4000 list fare - 800 (20%) = 3200, + 20% buffer = 3840
  assert.equal(create.params.amount, 3840)
  assert.equal(create.params.metadata.estimatedFareCents, '3200')
  assert.equal(create.params.metadata.promoCode, 'FALL20')
  assert.equal(create.params.metadata.promoDiscountCents, '800')
  const auth = db.tables.trips[0].metadata.fare_authorization
  assert.equal(auth.promoDiscountCents, 800)
  assert.equal(auth.grossFareCents, 4000)
  assert.equal(db.tables.trips[0].fare_cents, 4000, 'driver pay basis is untouched')
})

test('a trip without a code holds exactly as before', async () => {
  const db = memoryDb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_default' }],
    trips: [{ id: 'trip_plain', rider_id: 'rider_1', fare_cents: 4000, metadata: {} }],
  })
  const stripe = scriptedStripe({ creates: [{ id: 'pi_plain', status: 'requires_capture' }] })
  await authorizeRideRequest({ sb: db, stripe, trip: db.tables.trips[0] })
  const create = stripe.calls.find((call) => call.op === 'create')
  assert.equal(create.params.amount, 4800)
  assert.equal(create.params.metadata.promoCode, undefined)
})

async function completeWith(trip) {
  const transfers = []
  const finalized = []
  const stripe = { transfers: { create: async (params) => { transfers.push(params); return { id: 'tr_1' } } } }
  const deps = { ...mockDeps({ balance: 0 }), finalizePromo: async (_sb, args) => { finalized.push(args); return { ok: true } } }
  const sb = makeMockSb({ connectAccountId: 'acct_driver' })
  sb.seedTrip?.(trip)
  const res = await settleTripService({ sb, stripe, trip, action: 'complete', deps, actor: { id: trip.driver_id } })
  return { res, deps, transfers, finalized }
}

test('capture charges the discounted fare; the driver is paid on the full fare', async () => {
  const { res, deps, transfers, finalized } = await completeWith({
    id: 'trip_cap', rider_id: 'r1', driver_id: 'd1', status: 'in_progress', fare_cents: 4000, metadata: { promo: PROMO },
  })
  assert.equal(res.http, 200)
  assert.equal(res.body.status, 'completed')
  assert.equal(deps.payments.length, 1)
  assert.equal(deps.payments[0].amount_cents ?? deps.payments[0].amountCents, 3200)
  assert.equal(res.body.payout.amountCents, 3200, '80% of the 4000 pre-discount fare')
  assert.equal(transfers[0].amount, 3200)
  assert.deepEqual(finalized, [{ tripId: 'trip_cap', discountCents: 800, fareCents: 4000 }])
})

test('the capture discount follows the final fare and keeps the cap', async () => {
  const { deps, res } = await completeWith({
    id: 'trip_long', rider_id: 'r1', driver_id: 'd1', status: 'in_progress', fare_cents: 10000, metadata: { promo: PROMO },
  })
  // 20% of 10000 = 2000, capped at 1500
  assert.equal(deps.payments[0].amount_cents ?? deps.payments[0].amountCents, 8500)
  assert.equal(res.body.payout.amountCents, 8000)
})

test('without a code the capture and payout are unchanged', async () => {
  const { deps, res, finalized } = await completeWith({
    id: 'trip_none', rider_id: 'r1', driver_id: 'd1', status: 'in_progress', fare_cents: 4000, metadata: {},
  })
  assert.equal(deps.payments[0].amount_cents ?? deps.payments[0].amountCents, 4000)
  assert.equal(res.body.payout.amountCents, 3200)
  assert.equal(finalized.length, 0)
})
