/**
 * Website airport booking charges nothing up front. Client fare, deposit,
 * amount, total, and isStudent are ignored. A legacy Checkout webhook still
 * stamps an already-paid deposit so that trip can be claimed.
 * Stripe is mocked. No live charges.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'

for (const key of Object.keys(process.env)) {
  if (key.startsWith('GOOGLE_') || key.startsWith('STRIPE_')) delete process.env[key]
}

const { default: createCheckoutSessionHandler } = await import('../api/create-checkout-session.js')
const { default: webhookHandler } = await import('../api/stripe-webhook.js')
const { priceCheckoutBody } = await import('./authoritativeFare.js')
const { decideUnpaidAirportHoldTtl, UNPAID_AIRPORT_HOLD_TTL_MS } = await import('./abandonedCheckout.js')
const { isOpenPoolClaimable, isUnpaidAirportDepositTrip } = await import('../packages/rides-native/tripTags.js')

const GMAIL = {
  id: '77777777-7777-4777-8777-777777777777',
  email: 'spoof@gmail.com',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  user_metadata: { full_name: 'Spoof Rider' },
}
const TIGER = {
  id: '88888888-8888-4888-8888-888888888888',
  email: 'tiger@g.clemson.edu',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  user_metadata: { full_name: 'Tiger Rider' },
}
const SPOOF = {
  fareCents: 100,
  fare_cents: 100,
  fare: 1,
  depositCents: 25,
  deposit_cents: 25,
  deposit: 0.25,
  amount: 25,
  amountCents: 25,
  amount_cents: 25,
  total: 1,
  totalCents: 1,
  total_cents: 1,
  isStudent: true,
  is_student: true,
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writableEnded: false,
    headersSent: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      this.writableEnded = true
      this.body = payload == null ? '' : String(payload)
    },
  }
}

async function callHandler(handler, req, deps) {
  const res = mockRes()
  await handler({ headers: {}, ...req }, res, deps)
  let json = null
  try {
    json = res.body ? JSON.parse(res.body) : null
  } catch {
    json = null
  }
  return { status: res.statusCode, json }
}

function checkoutSb() {
  const tripsInserted = []
  const sb = {
    tripsInserted,
    async rpc(fn, args) {
      if (fn === 'merge_trip_metadata') {
        return { data: [{ id: args?.p_trip_id || tripsInserted.at(-1)?.id || 'trip_mock' }], error: null }
      }
      return { data: null, error: null }
    },
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        in() { return chain },
        lte() { return chain },
        gte() { return chain },
        gt() { return chain },
        order() { return chain },
        limit() { return chain },
        async maybeSingle() {
          return { data: null, error: null }
        },
        async single() {
          const trip = tripsInserted.at(-1) || { id: 'trip_mock_123' }
          return { data: { id: trip.id, ...trip }, error: null }
        },
        insert(payload) {
          if (table === 'trips') {
            tripsInserted.push({ id: `trip_${tripsInserted.length + 1}`, ...payload })
          }
          return chain
        },
        async update() {
          return { data: null, error: null }
        },
      }
      return chain
    },
  }
  return sb
}

function memoryDb() {
  const trips = new Map()
  const payments = []

  function match(row, filters) {
    return filters.every((filter) => row[filter.col] === filter.val)
  }

  function from(table) {
    const state = { filters: [], op: 'select', patch: null }
    const api = {
      select() { return api },
      eq(col, val) { state.filters.push({ col, val }); return api },
      is() { return api },
      in() { return api },
      update(patch) { state.op = 'update'; state.patch = patch; return api },
      insert(row) { state.op = 'insert'; state.patch = row; return api },
      maybeSingle() {
        return Promise.resolve(exec()).then((res) => ({
          data: Array.isArray(res.data) ? (res.data[0] ?? null) : res.data,
          error: res.error,
        }))
      },
      single() { return api.maybeSingle() },
      then(resolve, reject) { return Promise.resolve(exec()).then(resolve, reject) },
    }

    function exec() {
      if (table === 'payments') {
        if (state.op === 'insert') {
          const row = { id: `pay_${payments.length + 1}`, ...state.patch }
          payments.push(row)
          return { data: row, error: null }
        }
        return { data: payments.filter((row) => match(row, state.filters)), error: null }
      }
      if (table === 'trips') {
        if (state.op === 'update') {
          const updated = []
          for (const row of trips.values()) {
            if (!match(row, state.filters)) continue
            const next = { ...row, ...state.patch }
            trips.set(next.id, next)
            updated.push(next)
          }
          return { data: updated, error: null }
        }
        return { data: [...trips.values()].filter((row) => match(row, state.filters)), error: null }
      }
      if (table === 'trip_events' && state.op === 'insert') return { data: state.patch, error: null }
      return { data: null, error: null }
    }

    return api
  }

  function rpc(fn, args) {
    if (fn === 'merge_trip_metadata') {
      const trip = trips.get(args?.p_trip_id)
      if (!trip) return Promise.resolve({ data: null, error: { message: 'missing trip' } })
      trip.metadata = { ...(trip.metadata || {}), ...(args.p_patch || {}) }
      trips.set(trip.id, trip)
      return Promise.resolve({ data: { id: trip.id, metadata: trip.metadata }, error: null })
    }
    if (fn === 'grant_rider_social_for_trip') {
      return Promise.resolve({ data: { ok: true, granted: false }, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }

  return { from, rpc, trips, payments }
}

function webhookReq(event) {
  const stream = Readable.from([Buffer.from(JSON.stringify(event))])
  stream.method = 'POST'
  stream.headers = {}
  return stream
}

async function openCheckout(user, extra = {}) {
  const created = []
  const sb = checkoutSb()
  const res = await callHandler(
    createCheckoutSessionHandler,
    {
      method: 'POST',
      body: {
        airport: 'GSP',
        origin: 'https://clemsonrides.com',
        ...SPOOF,
        ...extra,
      },
    },
    {
      user,
      sb,
      stripeOk: () => true,
      ensureProfile: async () => ({ ok: true, created: false }),
      stripe: {
        checkout: {
          sessions: {
            async create(params) {
              created.push(params)
              return {
                id: 'cs_test_airport_deposit',
                url: 'https://checkout.stripe.com/c/pay/cs_test_airport_deposit',
              }
            },
          },
        },
      },
    },
  )
  return { res, created, sb }
}

test('airport checkout books the server fare and does not open a Checkout session', async () => {
  const { res, created, sb } = await openCheckout(GMAIL)
  assert.equal(res.status, 200, JSON.stringify(res.json))
  assert.equal(created.length, 0)
  assert.equal(res.json.depositCents, 0)
  assert.equal(res.json.charged, false)
  assert.equal(res.json.url, undefined)
  assert.equal(res.json.clientFareIgnored, true)
  assert.equal(res.json.dueAtTripEndCents, res.json.fareCents)
  const trip = sb.tripsInserted[0]
  assert.equal(trip.status, 'searching')
  assert.equal(trip.deposit_cents, 0)
  assert.equal(isUnpaidAirportDepositTrip(trip), false)
  assert.equal(isOpenPoolClaimable(trip), true)

  const expected = priceCheckoutBody({
    body: { airport: 'GSP', ...SPOOF },
    user: GMAIL,
    at: new Date(),
  })
  assert.equal(res.json.fareCents, expected.fareCents)
  assert.equal(expected.unitAmount, 0)
})

test('a confirmed Clemson email books the discounted server fare with nothing due now', async () => {
  const guest = await openCheckout(GMAIL, { isStudent: false })
  const student = await openCheckout(TIGER, { isStudent: false })
  assert.equal(guest.res.status, 200)
  assert.equal(student.res.status, 200)
  assert.ok(student.res.json.fareCents < guest.res.json.fareCents)
  assert.equal(student.created.length, 0)
  assert.equal(student.res.json.depositCents, 0)
  assert.equal(student.res.json.charged, false)
  assert.equal(student.res.json.studentDiscountApplied, true)
  assert.notEqual(student.res.json.fareCents, SPOOF.amount)
})

test('the webhook marks a legacy airport deposit paid so the trip enters matching', async () => {
  const { res, sb } = await openCheckout(GMAIL)
  assert.equal(res.status, 200, JSON.stringify(res.json))
  const inserted = sb.tripsInserted[0]
  const legacyDeposit = 2500
  const stale = new Date(Date.now() - UNPAID_AIRPORT_HOLD_TTL_MS - 1000).toISOString()
  const unpaid = { ...inserted, deposit_cents: legacyDeposit, created_at: stale }
  assert.equal(decideUnpaidAirportHoldTtl({ trip: unpaid, payments: [], now: Date.now() }).action, 'cancel')

  const db = memoryDb()
  db.trips.set(inserted.id, {
    ...inserted,
    deposit_cents: legacyDeposit,
    driver_id: null,
    created_at: stale,
    metadata: { ...(inserted.metadata || {}) },
  })
  const session = {
    id: 'cs_test_airport_deposit',
    object: 'checkout.session',
    payment_status: 'paid',
    status: 'complete',
    amount_total: legacyDeposit,
    payment_intent: 'pi_test_airport_deposit',
    metadata: {
      kind: 'airport_deposit',
      tripId: inserted.id,
      riderId: inserted.rider_id,
      depositCents: String(legacyDeposit),
      airport: 'GSP',
    },
  }
  const hookRes = mockRes()
  await webhookHandler(webhookReq({
    id: 'evt_airport_deposit',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: session },
  }), hookRes, {
    stripeSecret: 'sk_test_airport_deposit_mock',
    webhookSecret: '',
    serviceKey: '',
    serviceClient: () => db,
  })
  const body = JSON.parse(hookRes.body)
  assert.equal(hookRes.statusCode, 200, hookRes.body)
  assert.equal(body.received, true)
  assert.equal(body.type, 'checkout.session.completed')

  const trip = db.trips.get(inserted.id)
  assert.equal(trip.status, 'searching')
  assert.equal(trip.metadata.checkout_deposit.session_id, 'cs_test_airport_deposit')
  assert.ok(Number(trip.metadata.fare_paid_cents) >= trip.deposit_cents)
  assert.equal(isUnpaidAirportDepositTrip(trip), false)
  assert.equal(isOpenPoolClaimable(trip), true)
  assert.equal(db.payments.length, 1)
  assert.equal(db.payments[0].kind, 'deposit')
  assert.equal(db.payments[0].status, 'succeeded')
  assert.equal(db.payments[0].amount_cents, legacyDeposit)
  assert.equal(decideUnpaidAirportHoldTtl({ trip, payments: db.payments, now: Date.now() }).action, 'keep')
  assert.equal(decideUnpaidAirportHoldTtl({ trip, payments: db.payments, now: Date.now() }).reason, 'paid')
})
