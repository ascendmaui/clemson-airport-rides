import assert from 'node:assert/strict'
import test from 'node:test'
import { placeFareAuthorization, releaseOpenFareHold, syncBoostAuthorization } from './fareAuthorization.js'
import { buildPayoutRecord } from './payouts.js'
import bumpScheduledBoost from './endpoints/bumpScheduledBoost.js'
import releaseScheduledBoost from './endpoints/releaseScheduledBoost.js'
import { insertTripRow } from './scheduledBoostStore.js'

function mockRes() {
  return {
    statusCode: 200,
    body: '',
    setHeader() {},
    end(payload) { this.body = payload == null ? '' : String(payload) },
  }
}

async function call(handler, body, deps) {
  const res = mockRes()
  await handler({ method: 'POST', headers: {}, body }, res, deps)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

function scriptedStripe(step = {}) {
  const calls = []
  return {
    calls,
    paymentIntents: {
      async create(params) {
        calls.push({ op: 'create', params })
        if (step.createError) throw step.createError
        return { id: 'pi_new', status: 'requires_capture', amount: params.amount }
      },
      async cancel(id) {
        calls.push({ op: 'cancel', id })
        return { id, status: 'canceled' }
      },
      async incrementAuthorization(id, params) {
        calls.push({ op: 'increment', id, params })
        if (step.incrementError) throw step.incrementError
        return { id, status: 'requires_capture', amount: params.amount }
      },
    },
  }
}

test('fare hold create amount is the estimate, the buffer, and the boost', async () => {
  const stripe = scriptedStripe()
  const placed = await placeFareAuthorization({
    stripe,
    tripId: 'trip_boost',
    riderId: 'rider_1',
    customerId: 'cus_1',
    paymentMethodId: 'pm_1',
    backupPaymentMethodIds: [],
    estimatedFareCents: 10000,
    boostCents: 2000,
  })
  assert.equal(placed.ok, true)
  assert.equal(stripe.calls[0].params.amount, 14000)
  assert.equal(stripe.calls[0].params.metadata.boostCents, '2000')
  assert.equal(placed.authorization.boostCents, 2000)
  assert.equal(placed.authorization.bufferCents, 2000)
})

test('payout sweep adds the full boost on top of fare net, including carpool payouts', () => {
  const scheduled = buildPayoutRecord({
    id: 'sched',
    driver_id: 'drv',
    fare_cents: 10000,
    metadata: { boost_cents: 1500 },
  })
  assert.equal(scheduled.fareNetCents, 8000)
  assert.equal(scheduled.boostCents, 1500)
  assert.equal(scheduled.amountCents, 9500)

  const carpool = buildPayoutRecord({
    id: 'pool',
    driver_id: 'drv',
    fare_cents: 4200,
    metadata: { driver_payout_cents: 3600, boost_cents: 1000, kind: 'carpool' },
  })
  assert.equal(carpool.fareNetCents, 3600)
  assert.equal(carpool.boostCents, 1000)
  assert.equal(carpool.amountCents, 4600)
  assert.equal(carpool.amountCents - carpool.fareNetCents, carpool.boostCents)
})

test('bump rejects a lower or over-cap amount and increments an open hold', async () => {
  const trip = {
    id: 'trip_1',
    rider_id: 'rider_1',
    driver_id: null,
    status: 'scheduled',
    fare_cents: 8000,
    metadata: {
      boost_cents: 500,
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_hold',
        authorizationCents: 500 + 9600,
        estimatedFareCents: 8000,
        bufferCents: 1600,
        boostCents: 500,
      },
    },
  }
  const sb = {
    trip,
    from() {
      const api = {
        select() { return api },
        eq() { return api },
        in() { return api },
        is() { return api },
        update(patch) {
          if (patch.boost_cents != null) trip.boost_cents = patch.boost_cents
          if (patch.metadata) trip.metadata = { ...trip.metadata, ...patch.metadata }
          return api
        },
        maybeSingle() { return Promise.resolve({ data: { ...trip, metadata: { ...trip.metadata } }, error: null }) },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve) },
      }
      return api
    },
  }
  const over = await call(bumpScheduledBoost, { tripId: 'trip_1', boostCents: 10001 }, { sb, user: { id: 'rider_1' } })
  assert.equal(over.status, 400)
  assert.equal(over.json.code, 'boost_invalid')

  const lower = await call(bumpScheduledBoost, { tripId: 'trip_1', boostCents: 500 }, { sb, user: { id: 'rider_1' } })
  assert.equal(lower.status, 400)

  const stripe = scriptedStripe()
  const raised = await call(bumpScheduledBoost, { tripId: 'trip_1', boostCents: 2000 }, { sb, user: { id: 'rider_1' }, stripe })
  assert.equal(raised.status, 200)
  assert.equal(raised.json.boostCents, 2000)
  assert.equal(trip.metadata.boost_cents, 2000)
  assert.equal(trip.metadata.boost_driver_share_bps, 10000)
  assert.equal(stripe.calls[0].op, 'increment')
  assert.equal(stripe.calls[0].params.amount, 8000 + 1600 + 2000)
})

test('bump re-authorizes when increment authorization is not available', async () => {
  const trip = {
    id: 'trip_2',
    rider_id: 'rider_1',
    fare_cents: 5000,
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_old',
        authorizationCents: 6200,
        estimatedFareCents: 5000,
        bufferCents: 1000,
        boostCents: 200,
        paymentMethodId: 'pm_1',
      },
    },
  }
  const sb = {
    from(table) {
      const api = {
        select() { return api },
        eq() { return api },
        insert() { return api },
        update(patch) {
          if (patch.metadata) trip.metadata = patch.metadata
          return api
        },
        maybeSingle() {
          return Promise.resolve({ data: table === 'profiles' ? { id: 'rider_1', stripe_customer_id: 'cus', stripe_default_pm_id: 'pm_1' } : { ...trip }, error: null })
        },
        single() { return Promise.resolve({ data: { id: 'pay_1' }, error: null }) },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve) },
      }
      return api
    },
  }
  const stripe = scriptedStripe({ incrementError: new Error('increment_unsupported') })
  const result = await syncBoostAuthorization({ sb, stripe, trip, boostCents: 1000 })
  assert.equal(result.method, 'reauth')
  assert.equal(result.ok, true)
  assert.ok(stripe.calls.some((call) => call.op === 'cancel'))
  const created = stripe.calls.find((call) => call.op === 'create')
  assert.equal(created.params.amount, 5000 + 1000 + 1000)
})

test('rider cancel releases the open boost hold immediately', async () => {
  const trip = {
    id: 'trip_cancel',
    rider_id: 'rider_1',
    status: 'canceled',
    fare_cents: 8000,
    metadata: {
      boost_cents: 1000,
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_boost',
        authorizationCents: 10600,
        boostCents: 1000,
      },
    },
  }
  const sb = {
    from() {
      const api = {
        select() { return api },
        eq() { return api },
        update(patch) {
          if (patch.metadata) trip.metadata = patch.metadata
          return api
        },
        maybeSingle() { return Promise.resolve({ data: { ...trip, metadata: { ...trip.metadata } }, error: null }) },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve) },
      }
      return api
    },
  }
  const stripe = scriptedStripe()
  const released = await call(releaseScheduledBoost, { tripId: 'trip_cancel' }, { sb, user: { id: 'rider_1' }, stripe })
  assert.equal(released.status, 200)
  assert.equal(released.json.hold.released, true)
  assert.equal(stripe.calls[0].op, 'cancel')
  assert.equal(stripe.calls[0].id, 'pi_boost')
  assert.equal(trip.metadata.fare_authorization.status, 'canceled')
  assert.equal(trip.metadata.fare_authorization.reason, 'rider_cancel')

  trip.metadata.boost_cents = 0
  delete trip.metadata.fare_authorization
  const plain = await call(releaseScheduledBoost, { tripId: 'trip_cancel' }, { sb, user: { id: 'rider_1' }, stripe })
  assert.equal(plain.json.hold.reason, 'no_open_hold')
  assert.equal(stripe.calls.length, 1)

  const direct = await releaseOpenFareHold({
    sb,
    stripe,
    trip: {
      id: 'trip_none',
      metadata: { boost_cents: 500 },
    },
  })
  assert.equal(direct.skipped, true)
  assert.equal(direct.reason, 'no_open_hold')
})

test('trip insert falls back to metadata when boost_cents is not migrated yet', async () => {
  const rows = []
  const sb = {
    from() {
      let payload = null
      const api = {
        insert(row) {
          payload = row
          return api
        },
        select() { return api },
        single() {
          if (payload && Object.prototype.hasOwnProperty.call(payload, 'boost_cents') && rows.length === 0) {
            return Promise.resolve({ data: null, error: { message: "Could not find the 'boost_cents' column of 'trips' in the schema cache" } })
          }
          rows.push(payload)
          return Promise.resolve({ data: { id: 'trip_new', ...payload }, error: null })
        },
      }
      return api
    },
  }
  const inserted = await insertTripRow(sb, {
    rider_id: 'rider_1',
    status: 'scheduled',
    boost_cents: 1500,
    metadata: { boost_cents: 1500 },
  })
  assert.equal(inserted.error, null)
  assert.equal(rows.length, 1)
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'boost_cents'), false)
  assert.equal(rows[0].metadata.boost_cents, 1500)
})
