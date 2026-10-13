import test from 'node:test'
import assert from 'node:assert/strict'
import { settleTrip } from './tripSettle.js'
import settleEndpoint from './endpoints/tripSettle.js'
import tripStatusEndpoint from './endpoints/tripStatus.js'
import { tripCompletionDb } from '../tests/fixtures/tripCompletionDb.js'

const base = { id: 't1', rider_id: 'r1', driver_id: 'd1', status: 'in_progress', fare_cents: 1000, metadata: {} }
const actor = { id: 'd1' }
function noStripe() {
  return new Proxy({}, { get() { assert.fail('Unexpected Stripe call') } })
}
async function endpoint(handler, sb, user = actor, body = {}) {
  let result
  const res = { setHeader() {}, end(value) { result = { http: this.statusCode, body: JSON.parse(value) } } }
  await handler({ method: 'POST', headers: {}, body: { tripId: 't1', action: 'complete', op: 'complete', ...body } }, res, { sb, user, stripeClient: noStripe })
  return result
}

test('only the assigned driver may complete, including completed replays', async () => {
  for (const status of ['in_progress', 'completed']) {
    for (const id of ['r1', 'other-driver', null]) {
      const trip = { ...base, status }
      const sb = tripCompletionDb(trip)
      const result = await settleTrip({ sb, stripe: noStripe(), trip, actor: { id }, action: 'complete' })
      assert.equal(result.http, 403)
      assert.equal(sb.updates.length, 0)
      assert.equal(sb.tables.payments.length, 0)
      assert.equal(sb.tables.driver_payouts.length, 0)
    }
  }
})

test('invalid completion statuses fail before fare pricing, Stripe or payout', async () => {
  for (const status of ['accepted', 'arriving', 'arrived', 'canceled', 'canceled_midride', 'cancelled_wait', 'searching', 'offered', 'scheduled']) {
    const trip = { ...base, status, fare_cents: null }
    const sb = tripCompletionDb(trip)
    const result = await settleTrip({ sb, stripe: noStripe(), trip, actor, action: 'complete' })
    assert.equal(result.http, 409, status)
    assert.equal(result.body.code, 'invalid_status')
    assert.equal(sb.updates.length, 0)
    assert.equal(sb.tables.payments.length, 0)
    assert.equal(sb.tables.driver_payouts.length, 0)
  }
})

test('completed is a harmless success even with no stored fare', async () => {
  const trip = { ...base, status: 'completed', fare_cents: null }
  const sb = tripCompletionDb(trip)
  const result = await settleTrip({ sb, stripe: noStripe(), trip, actor, action: 'complete' })
  assert.deepEqual(result, { http: 200, body: { ok: true, idempotent: true, progressed: false, status: 'completed' } })
  assert.equal(sb.updates.length, 0)
  assert.equal(sb.tables.payments.length, 0)
  assert.equal(sb.tables.driver_payouts.length, 0)
})

test('admin completion requires an explicit verified override', async () => {
  const trip = { ...base, fare_cents: 0 }
  const sb = tripCompletionDb(trip, { profiles: [{ id: 'admin', role: 'admin' }] })
  const admin = { id: 'admin' }
  assert.equal((await settleTrip({ sb, trip, actor: admin, action: 'complete' })).http, 403)
  assert.equal((await settleTrip({ sb, trip, actor: { id: 'r1' }, action: 'complete', adminOverride: true })).http, 403)
  const result = await settleTrip({ sb, trip, actor: admin, action: 'complete', adminOverride: true })
  assert.equal(result.http, 200)
  assert.equal(result.body.status, 'completed')
})

test('a fresh completion claim refuses another collector; an expired claim can be reclaimed', async () => {
  for (const age of [0, 121000]) {
    const trip = { ...base, fare_cents: 0, metadata: { keep: true, completion_claim: { at: new Date(Date.now() - age).toISOString(), by: 'd1', token: 'old' } } }
    const sb = tripCompletionDb(trip)
    const result = await settleTrip({ sb, stripe: noStripe(), trip, actor, action: 'complete' })
    assert.equal(result.http, age ? 200 : 409)
    if (!age) assert.equal(result.body.code, 'completion_in_progress')
    assert.equal(sb.tables.trips[0].metadata.keep, true)
  }
})

test('concurrent completion requests capture once and emit one event and payout', async () => {
  const trip = { ...base, metadata: { fare_authorization: { status: 'requires_capture', paymentIntentId: 'pi_hold', authorizationCents: 1200 } } }
  const sb = tripCompletionDb(trip, { profiles: [{ id: 'r1', stripe_customer_id: 'cus_r1', stripe_default_pm_id: 'pm_r1' }, { id: 'd1', stripe_account_id: 'acct_d1' }] })
  let started, resume
  const capturing = new Promise(resolve => { started = resolve })
  const pending = new Promise(resolve => { resume = resolve })
  let captures = 0, transfers = 0
  const stripe = {
    paymentIntents: {
      retrieve: async () => ({ id: 'pi_hold', status: 'requires_capture' }),
      capture: async () => { captures++; started(); await pending; return { id: 'pi_hold', status: 'succeeded', amount_received: 1000 } },
    },
    transfers: { create: async () => { transfers++; return { id: 'tr1' } } },
  }
  const first = settleTrip({ sb, stripe, trip, actor, action: 'complete' })
  await capturing
  const second = await settleTrip({ sb, stripe, trip, actor, action: 'complete' })
  assert.equal(second.http, 409)
  assert.equal(second.body.code, 'completion_in_progress')
  resume()
  assert.equal((await first).http, 200)
  const replay = await settleTrip({ sb, stripe: noStripe(), trip, actor, action: 'complete' })
  assert.equal(replay.body.idempotent, true)
  assert.equal(captures, 1)
  assert.equal(transfers, 1)
  assert.equal(sb.tables.trip_events.length, 1)
  assert.equal(sb.tables.driver_payouts.length, 1)
})

test('claim compare-and-set on the claim slot refuses a racing claimant', async () => {
  for (const otherClaim of [true]) {
    let raced = false
    const sb = tripCompletionDb({ ...base, fare_cents: 0 }, { beforeUpdate({ patch, tables }) {
      if (raced || !patch.metadata?.completion_claim) return
      raced = true
      tables.trips[0].metadata = otherClaim
        ? { completion_claim: { at: new Date().toISOString(), by: 'd1', token: 'winner' } }
        : { concurrent_key: 'preserved' }
    } })
    const result = await settleTrip({ sb, trip: base, actor, action: 'complete', stripe: noStripe() })
    assert.equal(result.http, otherClaim ? 409 : 200)
    if (otherClaim) assert.equal(result.body.code, 'completion_in_progress')
    else assert.equal(sb.tables.trips[0].metadata.concurrent_key, 'preserved')
  }
})

test('402 clears the owned claim while preserving the payment hold, permitting a retry', async () => {
  const sb = tripCompletionDb(base)
  let attempts = 0
  const deps = {
    getCredits: async () => 0,
    loadProfile: async () => ({ stripe_customer_id: 'cus_r1', stripe_default_pm_id: 'pm_r1' }),
    findPayment: async () => null,
    insertPayment: async () => ({ id: 'pay1' }),
    setHold: async () => { sb.tables.trips[0].metadata.payment_hold = { code: 'card_declined' } },
    clearHold: async () => {},
    createPaymentIntent: async () => {
      if (++attempts === 1) throw Object.assign(new Error('Declined'), { code: 'card_declined' })
      return { id: 'pi1', status: 'succeeded', amount: 1000 }
    },
  }
  const args = { sb, trip: base, actor, action: 'complete', deps }
  assert.equal((await settleTrip(args)).http, 402)
  assert.equal(sb.tables.trips[0].metadata.completion_claim, undefined)
  assert.equal(sb.tables.trips[0].metadata.payment_hold.code, 'card_declined')
  assert.equal(sb.tables.trips[0].status, 'in_progress')
  assert.equal((await settleTrip(args)).http, 200)
  assert.equal(attempts, 2)
})

test('final completion update is conditional and a lost race never emits an event or payout', async () => {
  for (const status of ['completed', 'canceled_midride', 'in_progress']) {
    const sb = tripCompletionDb({ ...base, fare_cents: 0 }, { beforeUpdate({ patch, filters, tables }) {
      if (patch.status !== 'completed') return
      assert.ok(filters.some(([key, value]) => key === 'status' && value === 'in_progress'))
      tables.trips[0].status = status
      if (status === 'in_progress') tables.trips[0].metadata.completion_claim.token = 'new-owner'
    } })
    const result = await settleTrip({ sb, trip: base, actor, action: 'complete', stripe: noStripe() })
    assert.equal(result.http, status === 'completed' ? 200 : 409)
    if (status === 'completed') assert.equal(result.body.idempotent, true)
    else assert.equal(result.body.code, 'invalid_status')
    assert.equal(sb.tables.trip_events.length, 0)
    assert.equal(sb.tables.driver_payouts.length, 0)
  }
})

test('a fare hold capture failure clears the claim for a successful retry', async () => {
  const trip = { ...base, metadata: { fare_authorization: { status: 'requires_capture', paymentIntentId: 'pi_hold', authorizationCents: 1200 } } }
  const sb = tripCompletionDb(trip)
  let declined = true, captured = false, captures = 0
  const stripe = { paymentIntents: {
    retrieve: async () => ({ id: 'pi_hold', status: captured ? 'succeeded' : 'requires_capture' }),
    capture: async () => {
      captures++
      if (declined) throw Object.assign(new Error('Declined'), { code: 'card_declined' })
      captured = true
      return { id: 'pi_hold', status: 'succeeded', amount_received: 1000 }
    },
  } }
  const args = { sb, stripe, trip, actor, action: 'complete' }
  const failure = await settleTrip(args)
  assert.equal(failure.http, 402)
  assert.equal(sb.tables.trips[0].status, 'in_progress')
  assert.equal(sb.tables.trips[0].metadata.completion_claim, undefined)
  assert.equal(sb.tables.driver_payouts.length, 0)
  declined = false
  assert.equal((await settleTrip(args)).http, 200)
  assert.ok(captures >= 2)
})

test('both completion endpoints enforce guards and expose completed replays as success', async () => {
  for (const handler of [settleEndpoint, tripStatusEndpoint]) {
    for (const id of ['r1', 'other-driver']) {
      assert.equal((await endpoint(handler, tripCompletionDb(base), { id })).http, 403)
    }
    for (const status of ['accepted', 'arriving', 'arrived', 'canceled_midride']) {
      const result = await endpoint(handler, tripCompletionDb({ ...base, status }))
      assert.equal(result.http, 409)
      assert.equal(result.body.code, 'invalid_status')
    }
    const result = await endpoint(handler, tripCompletionDb({ ...base, status: 'completed', fare_cents: null }))
    assert.equal(result.http, 200)
    assert.equal(result.body.idempotent, true)
    assert.equal(result.body.progressed, false)
  }
})

test('both completion endpoints allow an admin only with adminOverride', async () => {
  for (const handler of [settleEndpoint, tripStatusEndpoint]) {
    const sb = tripCompletionDb({ ...base, fare_cents: 0 }, { profiles: [{ id: 'admin', role: 'admin' }] })
    assert.equal((await endpoint(handler, sb, { id: 'admin' })).http, 403)
    assert.equal((await endpoint(handler, sb, { id: 'admin' }, { adminOverride: true })).http, 200)
  }
})

test('settle cancel keeps the generic terminal rejection; charge stays exempt as before', async () => {
  for (const status of ['completed', 'canceled']) {
    const result = await endpoint(settleEndpoint, tripCompletionDb({ ...base, status }), actor, { action: 'cancel' })
    assert.equal(result.http, 409)
    assert.equal(result.body.error, `Trip already ${status}`)
    const charge = await endpoint(settleEndpoint, tripCompletionDb({ ...base, status }), actor, { action: 'charge' })
    assert.notEqual(charge.body.error, `Trip already ${status}`)
  }
})
