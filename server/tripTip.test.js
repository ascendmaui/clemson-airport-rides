import assert from 'node:assert/strict'
import test from 'node:test'
import handler from './endpoints/tripTip.js'
import { sanitizeCompletedTripForDriver } from '../src/lib/driverEarnings.js'

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    writableEnded: false,
    headersSent: false,
    body: '',
    setHeader(key, value) { this.headers[key] = value },
    end(body) {
      this.writableEnded = true
      this.body = body
    },
  }
}

function read(res) {
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') }
}

function tipDb(seed = {}) {
  const state = {
    trips: [seed.trip],
    payments: [...(seed.payments || [])],
    profiles: [seed.profile],
    stripeCalls: [],
    transfers: [],
  }
  function rows(table) {
    return state[table]
  }
  function from(table) {
    const ctx = { filters: [], patch: null, mode: 'select' }
    const api = {
      select() { return api },
      eq(col, val) {
        ctx.filters.push([col, val])
        return api
      },
      maybeSingle() {
        const found = rows(table).find((row) => ctx.filters.every(([col, val]) => row[col] === val)) || null
        return Promise.resolve({ data: found, error: null })
      },
      insert(row) {
        rows(table).push({ ...row })
        return Promise.resolve({ error: null })
      },
      update(patch) {
        ctx.mode = 'update'
        ctx.patch = patch
        return api
      },
      then(resolve, reject) {
        try {
          if (ctx.mode === 'update') {
            for (const row of rows(table)) {
              if (ctx.filters.every(([col, val]) => row[col] === val)) Object.assign(row, ctx.patch)
            }
          }
          return Promise.resolve({ error: null }).then(resolve, reject)
        } catch (err) {
          return Promise.reject(err).then(resolve, reject)
        }
      },
    }
    return api
  }
  const stripe = {
    paymentIntents: {
      async create(params) {
        state.stripeCalls.push(params)
        return {
          id: `pi_${state.stripeCalls.length}`,
          status: 'succeeded',
          amount: params.amount,
          client_secret: 'cs_test_tip',
          metadata: params.metadata,
        }
      },
      async retrieve() {
        return { id: 'pi_final', status: 'succeeded', amount: 800, metadata: {} }
      },
    },
    transfers: {
      async create(params) {
        state.transfers.push(params)
        throw new Error('tip must not create a Connect transfer')
      },
    },
    customers: {
      async create() {
        throw new Error('saved card test must not create a customer')
      },
    },
  }
  return { state, sb: { from }, stripe }
}

function completedTrip(extra = {}) {
  return {
    id: 'trip_1',
    rider_id: 'rider_1',
    driver_id: 'driver_1',
    status: 'completed',
    fare_cents: 4000,
    tip_cents: 0,
    metadata: { airport: 'GSP' },
    ...extra,
  }
}

function depsFor(db, { status = 'succeeded' } = {}) {
  if (status !== 'succeeded') {
    const original = db.stripe.paymentIntents.create
    db.stripe.paymentIntents.create = async (params) => {
      const pi = await original(params)
      return { ...pi, status }
    }
  }
  return {
    stripeOk: () => true,
    admin: () => db.sb,
    userFromAuth: async () => ({ id: 'rider_1' }),
    stripe: db.stripe,
  }
}

async function post(db, body, options) {
  const res = mockRes()
  await handler({ method: 'POST', body, headers: {} }, res, depsFor(db, options))
  return read(res)
}

test('a completed ride charges 20% of the fare through Stripe and owes it to the driver', async () => {
  const db = tipDb({
    trip: completedTrip(),
    profile: {
      id: 'rider_1',
      email: 'rider@clemson.edu',
      stripe_customer_id: 'cus_test',
      stripe_default_pm_id: 'pm_test',
    },
  })
  const res = await post(db, { tripId: 'trip_1', tipPercent: 20, tipCents: 200 })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.tipCents, 800)
  assert.equal(res.body.tipPercent, 20)
  assert.equal(res.body.fareCents, 4000)
  assert.equal(res.body.credit, 'owed')
  assert.equal(res.body.driverId, 'driver_1')
  assert.equal(res.body.driverEarningsCents, 640)
  assert.equal(res.body.platformFeeCents, 160)
  assert.equal(db.state.stripeCalls.length, 1)
  assert.equal(db.state.stripeCalls[0].amount, 800)
  assert.equal(db.state.stripeCalls[0].confirm, true)
  assert.equal(db.state.stripeCalls[0].metadata.kind, 'tip')
  assert.equal(db.state.stripeCalls[0].metadata.driverId, 'driver_1')
  assert.equal(db.state.transfers.length, 0)
  assert.equal(db.state.payments.length, 1)
  assert.equal(db.state.payments[0].kind, 'tip')
  assert.equal(db.state.payments[0].amount_cents, 800)
  assert.equal(db.state.payments[0].driver_earnings_cents, 640)
  assert.equal(db.state.payments[0].metadata.driver_id, 'driver_1')
  assert.equal(db.state.trips[0].tip_cents, 800)
  assert.equal(db.state.trips[0].metadata.tip_owed.status, 'owed')
  assert.equal(db.state.trips[0].metadata.tip_owed.driverId, 'driver_1')
  assert.equal(db.state.trips[0].metadata.airport, 'GSP')

  const earnings = sanitizeCompletedTripForDriver(db.state.trips[0], { payments: db.state.payments })
  assert.equal(earnings.tipCents, 800)
  assert.equal(earnings.earnedCents, 3840)
})

test('custom amount is charged as cents and still owed to the assigned driver', async () => {
  const db = tipDb({
    trip: completedTrip(),
    profile: {
      id: 'rider_1',
      stripe_customer_id: 'cus_test',
      stripe_default_pm_id: 'pm_test',
    },
  })
  const res = await post(db, { tripId: 'trip_1', tipCents: 750 })
  assert.equal(res.status, 200)
  assert.equal(res.body.tipCents, 750)
  assert.equal(res.body.tipPercent, null)
  assert.equal(res.body.driverEarningsCents, 600)
  assert.equal(db.state.stripeCalls[0].amount, 750)
  assert.equal(db.state.transfers.length, 0)
})

test('percent tip is refused when the fare is not on the trip', async () => {
  const db = tipDb({
    trip: completedTrip({ fare_cents: null }),
    profile: { id: 'rider_1', stripe_customer_id: 'cus_test', stripe_default_pm_id: 'pm_test' },
  })
  const res = await post(db, { tripId: 'trip_1', tipPercent: 15 })
  assert.equal(res.status, 409)
  assert.match(res.body.error, /Fare is not on this ride yet/)
  assert.equal(db.state.stripeCalls.length, 0)
  assert.equal(db.state.payments.length, 0)
})

test('a tip percent outside 15, 20, and 25 is refused', async () => {
  const db = tipDb({
    trip: completedTrip(),
    profile: { id: 'rider_1', stripe_customer_id: 'cus_test', stripe_default_pm_id: 'pm_test' },
  })
  const res = await post(db, { tripId: 'trip_1', tipPercent: 10 })
  assert.equal(res.status, 400)
  assert.match(res.body.error, /15, 20, or 25/)
  assert.equal(db.state.stripeCalls.length, 0)
})

test('open rides and second tips are not charged', async () => {
  const open = tipDb({
    trip: completedTrip({ status: 'in_progress' }),
    profile: { id: 'rider_1', stripe_customer_id: 'cus_test', stripe_default_pm_id: 'pm_test' },
  })
  const openRes = await post(open, { tripId: 'trip_1', tipPercent: 15 })
  assert.equal(openRes.status, 409)
  assert.equal(open.state.stripeCalls.length, 0)

  const again = tipDb({
    trip: completedTrip({ tip_cents: 800 }),
    profile: { id: 'rider_1', stripe_customer_id: 'cus_test', stripe_default_pm_id: 'pm_test' },
  })
  const againRes = await post(again, { tripId: 'trip_1', tipPercent: 25 })
  assert.equal(againRes.status, 409)
  assert.equal(again.state.stripeCalls.length, 0)
})

test('without a saved card the tip is not confirmed and nothing is owed yet', async () => {
  const db = tipDb({
    trip: completedTrip(),
    profile: { id: 'rider_1', stripe_customer_id: 'cus_test', stripe_default_pm_id: null },
  })
  const res = await post(db, { tripId: 'trip_1', tipPercent: 25 })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, false)
  assert.equal(res.body.needsPaymentMethod, true)
  assert.equal(res.body.tipCents, 1000)
  assert.equal(db.state.stripeCalls[0].confirm, undefined)
  assert.equal(db.state.payments.length, 0)
  assert.equal(db.state.trips[0].tip_cents, 0)
  assert.equal(db.state.transfers.length, 0)
})
