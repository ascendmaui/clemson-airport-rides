import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultCollectDeps } from './collectPayment.js'
import { settleTrip } from './tripSettle.js'
import midride from './endpoints/tripCancelMidride.js'
import { handleRiderSwitch } from './endpoints/riderSwitch.js'
import { settleSwitchHold } from './riderSwitchHold.js'
import { applyTripWait } from './tripWait.js'
import scheduled from './endpoints/releaseScheduledBoost.js'
import backup from './endpoints/backupQueue.js'
import { releaseOpenFareHold } from './fareAuthorization.js'
import { backupBookingMetadata } from '../shared/backupDriverQueue.js'
import { seedHold, fakeStripe, call } from '../tests/fixtures/cancelFareHolds.js'

const user = { id: 'rider-1' }
const switchDeps = { prefs: {}, gameDayMultiplier: null,
  listDrivers: async () => ({ drivers: [] }), priceTier: async () => ({ fareCents: 1850 }) }
const cancels = (stripe) => stripe.calls.filter((call) => call.op === 'cancel')

for (const status of ['requires_capture', 'captured', null]) {
  test(`settle cancel releases only an open hold (${status}) after the status update`, async () => {
    const { sb, trip } = seedHold(status)
    const stripe = fakeStripe()
    const cancel = stripe.paymentIntents.cancel
    stripe.paymentIntents.cancel = (...args) => {
      assert.equal(trip.status, 'canceled')
      return cancel(...args)
    }
    const result = await settleTrip({ sb, stripe, trip: structuredClone(trip), action: 'cancel' })
    assert.equal(result.http, 200)
    assert.equal(trip.status, 'canceled')
    assert.equal(cancels(stripe).length, status === 'requires_capture' ? 1 : 0)
    await settleTrip({ sb, stripe, trip: structuredClone(trip), action: 'cancel' })
    assert.equal(cancels(stripe).length, status === 'requires_capture' ? 1 : 0)
  })

  test(`midride cancel releases only an open hold (${status}) and charges once`, async () => {
    const { sb, trip } = seedHold(status, { status: 'in_progress' })
    const stripe = fakeStripe()
    let charged = 0
    const deps = { sb, stripe, user, collectMidrideCharge: async ({ amountCents }) => {
      charged += 1
      const pi = await stripe.paymentIntents.create({ amount: amountCents })
      return { paymentStatus: 'succeeded', stripePaymentIntentId: pi.id }
    } }
    const result = await call(midride, { tripId: trip.id, confirm: true }, deps)
    assert.equal(result.statusCode, 200)
    assert.equal(trip.status, 'canceled_midride')
    assert.equal(charged, 1)
    assert.equal(cancels(stripe).length, status === 'requires_capture' ? 1 : 0)
    await call(midride, { tripId: trip.id, confirm: true }, deps)
    assert.equal(charged, 1)
    assert.equal(cancels(stripe).length, status === 'requires_capture' ? 1 : 0)
    assert.equal(trip.metadata.preserved, true)
  })

  test(`rider-switch cancel releases only an open hold (${status})`, async () => {
    const { sb, trip } = seedHold(status)
    const stripe = fakeStripe()
    const cancel = stripe.paymentIntents.cancel
    stripe.paymentIntents.cancel = (...args) => {
      assert.equal(trip.status, 'canceled')
      return cancel(...args)
    }
    const result = await handleRiderSwitch(sb, user, { tripId: trip.id, action: 'cancel', confirm: true }, { ...switchDeps, stripe })
    assert.equal(result.status, 200)
    assert.equal(trip.status, 'canceled')
    assert.equal(cancels(stripe).length, status === 'requires_capture' ? 1 : 0)
    assert.equal(trip.metadata.preserved, true)
  })

  for (const action of ['cancel', 'tick', 'start']) {
    test(`wait ${action} releases only an open hold (${status}) on cancelled_wait after charging`, async () => {
      const { sb, trip } = seedHold(status, { status: 'cancelled_wait' })
      sb.rpc = async () => ({ data: { trip: structuredClone(trip), should_charge: true } })
      const stripe = fakeStripe()
      let charged = false
      const cancel = stripe.paymentIntents.cancel
      stripe.paymentIntents.cancel = (...args) => { assert.equal(charged, true); return cancel(...args) }
      const deps = { stripe, chargeWaitFees: async () => { charged = true; return { status: 'succeeded' } } }
      await applyTripWait(sb, { action, tripId: trip.id, actorId: 'driver-1' }, deps)
      await applyTripWait(sb, { action, tripId: trip.id, actorId: 'driver-1' }, deps)
      assert.equal(cancels(stripe).length, status === 'requires_capture' ? 1 : 0)
      if (status === 'requires_capture') assert.equal(trip.metadata.fare_authorization.reason, 'wait_cancel')
    })
  }

  test(`scheduled cancel without boost releases only an open hold (${status})`, async () => {
    const { sb, trip } = seedHold(status, { status: 'canceled' })
    const stripe = fakeStripe()
    const deps = { sb, user, stripe }
    const result = await call(scheduled, { tripId: trip.id }, deps)
    assert.equal(result.statusCode, 200)
    await call(scheduled, { tripId: trip.id }, deps)
    assert.equal(cancels(stripe).length, status === 'requires_capture' ? 1 : 0)
  })
}

test('settle cancel collects a separate cancel fee then releases the fare hold', async () => {
  const { sb, trip } = seedHold()
  const stripe = fakeStripe()
  const result = await settleTrip({ sb, stripe, trip, action: 'cancel', explicitAmountCents: 500,
    methods: ['card'], deps: { ...defaultCollectDeps(sb, stripe), getCredits: async () => 0 } })
  assert.equal(result.http, 200)
  assert.deepEqual(stripe.calls.map((call) => call.op), ['create', 'cancel'])
  assert.equal(stripe.calls[0].params.amount, 500)
  assert.equal(result.body.payment.paymentIntentId, 'pi_fee')
})

test('a hold captured in Stripe is never canceled even with stale requires_capture metadata', async () => {
  const { sb, trip } = seedHold()
  const stripe = fakeStripe({ status: 'succeeded' })
  const result = await settleTrip({ sb, stripe, trip, action: 'cancel' })
  assert.equal(result.http, 200)
  assert.equal(cancels(stripe).length, 0)
})

test('switches and rerequests keep the hold on the continuing ride', async () => {
  for (const action of ['rerequest', 'switch-driver', 'switch-tier']) {
    const { sb, trip } = seedHold()
    const stripe = fakeStripe()
    const result = await handleRiderSwitch(sb, user, { tripId: trip.id, action, confirm: true,
      driverId: 'driver-2', tier: 'wait' }, { ...switchDeps, stripe,
      listDrivers: async () => ({ drivers: [{ id: 'driver-2' }] }),
    })
    assert.equal(result.status, 200)
    assert.equal(trip.status, 'searching')
    assert.equal(trip.metadata.fare_authorization.paymentIntentId, 'pi_hold')
    assert.equal(trip.metadata.fare_authorization.status, 'requires_capture')
    assert.equal(cancels(stripe).length, 0)
  }
})

test('ending a credits-selected ride still releases any existing card hold', async () => {
  const { sb, trip } = seedHold()
  trip.metadata.billing_choice = 'credits'
  const stripe = fakeStripe()
  const result = await handleRiderSwitch(sb, user, { tripId: trip.id, action: 'cancel', confirm: true }, { ...switchDeps, stripe })
  assert.equal(result.status, 200)
  assert.equal(cancels(stripe).length, 1)
})

for (const withBackup of [true, false]) {
  test(`backup primary cancel keeps the hold when ${withBackup ? 'promoted' : 'reopened to pool'}`, async () => {
    const { sb, trip } = seedHold('requires_capture', { status: 'scheduled', pickup_at: '2026-10-10T16:00:00Z' })
    trip.metadata.backup_queue = { ...backupBookingMetadata(1000, new Date()), primaryDriverId: 'driver-1',
      backupDriverId: withBackup ? 'driver-2' : null }
    const stripe = fakeStripe()
    const result = await call(backup, { tripId: trip.id, op: 'cancel' }, { sb, stripe, user: { id: 'driver-1' } })
    assert.equal(result.statusCode, 200)
    assert.equal(result.body.action, withBackup ? 'promote' : 'pool')
    assert.equal(cancels(stripe).length, 0)
    assert.equal(trip.metadata.fare_authorization.status, 'requires_capture')
  })
}

for (const status of ['requires_capture', 'captured', null]) {
  test(`backup cancel releases only an open hold if the trip actually ended (${status})`, async () => {
    const { sb, trip } = seedHold(status, { status: 'scheduled' })
    trip.metadata.backup_queue = { ...backupBookingMetadata(1000, new Date()), primaryDriverId: 'driver-1' }
    const from = sb.from
    // A concurrent terminal transition wins before the endpoint reload.
    sb.from = (table) => {
      const query = from(table)
      const select = query.select
      query.select = (columns, ...args) => {
        if (table === 'trips' && columns === 'id, status, metadata') trip.status = 'canceled'
        return select(columns, ...args)
      }
      return query
    }
    const stripe = fakeStripe()
    const result = await call(backup, { tripId: trip.id, op: 'cancel' }, { sb, stripe, user: { id: 'driver-1' } })
    assert.equal(result.statusCode, 200)
    assert.equal(cancels(stripe).length, status === 'requires_capture' ? 1 : 0)
  })
}

test('release failures leave every canceled path successful and the hold retryable', async () => {
  for (const path of ['settle', 'switch', 'midride', 'scheduled', 'wait']) {
    const { sb, trip } = seedHold('requires_capture', { status: path === 'midride' ? 'in_progress' : path === 'scheduled' ? 'canceled' : 'accepted' })
    const stripe = fakeStripe({ failCancel: true })
    if (path === 'settle') assert.equal((await settleTrip({ sb, stripe, trip, action: 'cancel' })).http, 200)
    if (path === 'switch') assert.equal((await handleRiderSwitch(sb, user, { tripId: trip.id, action: 'cancel', confirm: true }, { ...switchDeps, stripe })).status, 200)
    if (path === 'midride') assert.equal((await call(midride, { tripId: trip.id, confirm: true }, { sb, stripe, user,
      collectMidrideCharge: async () => ({ paymentStatus: 'payment_required' }) })).statusCode, 200)
    if (path === 'scheduled') assert.equal((await call(scheduled, { tripId: trip.id }, { sb, stripe, user })).statusCode, 200)
    if (path === 'wait') {
      trip.status = 'cancelled_wait'
      sb.rpc = async () => ({ data: { trip: structuredClone(trip), should_charge: false } })
      await applyTripWait(sb, { action: 'tick', tripId: trip.id, actorId: user.id }, { stripe })
    }
    assert.ok(['canceled', 'canceled_midride', 'cancelled_wait'].includes(trip.status))
    assert.equal(trip.metadata.fare_authorization.status, 'requires_capture')
  }
})

test('metadata failures never escape release; a retry repairs the metadata without another Stripe cancel', async () => {
  const { sb, trip } = seedHold()
  const stripe = fakeStripe()
  const broken = { from() { throw new Error('Database unavailable') } }
  assert.equal((await releaseOpenFareHold({ sb: broken, stripe, trip: structuredClone(trip) })).ok, false)
  assert.equal((await releaseOpenFareHold({ sb, stripe, trip })).released, true)
  assert.equal(cancels(stripe).length, 1)
  assert.equal(trip.metadata.fare_authorization.status, 'canceled')
  assert.equal(cancels(stripe)[0].options.idempotencyKey, 'fare_release:pi_hold')
  assert.equal((await settleSwitchHold({ sb, stripe, trip, quote: { hold: 'release' } })).ok, true)
  assert.equal(cancels(stripe).length, 1)
})

test('wait cancel releases its hold even when fee collection throws', async () => {
  const { sb, trip } = seedHold('requires_capture', { status: 'cancelled_wait' })
  sb.rpc = async () => ({ data: { trip: structuredClone(trip), should_charge: true } })
  const stripe = fakeStripe()
  await assert.rejects(applyTripWait(sb, { action: 'tick', tripId: trip.id, actorId: user.id }, {
    stripe, chargeWaitFees: async () => { throw new Error('Fee collector unavailable') },
  }), /Fee collector unavailable/)
  assert.equal(cancels(stripe).length, 1)
  assert.equal(trip.metadata.fare_authorization.status, 'canceled')
})

test('opening carpool ends the old trip and releases its hold', async () => {
  const { sb, trip } = seedHold()
  const stripe = fakeStripe()
  const result = await handleRiderSwitch(sb, user, { tripId: trip.id, action: 'open-carpool', confirm: true }, { ...switchDeps, stripe })
  assert.equal(result.status, 200)
  assert.equal(trip.status, 'canceled')
  assert.equal(cancels(stripe).length, 1)
})

test('Stripe release survives metadata write errors and allows the sweep to repair them', async () => {
  const { sb, trip } = seedHold()
  const stripe = fakeStripe()
  const from = sb.from
  sb.from = (table) => {
    const query = from(table)
    query.update = () => ({ eq: async () => ({ error: { message: 'Write unavailable' } }) })
    return query
  }
  assert.equal((await releaseOpenFareHold({ sb, stripe, trip: structuredClone(trip) })).ok, false)
  assert.equal(trip.metadata.fare_authorization.status, 'requires_capture')
  sb.from = from
  assert.equal((await releaseOpenFareHold({ sb, stripe, trip: structuredClone(trip), reason: 'cancel_sweep' })).released, true)
  assert.equal(cancels(stripe).length, 1)
  assert.equal(trip.metadata.fare_authorization.reason, 'cancel_sweep')
})

test('a cancel fee already collected from the fare intent is neither charged again nor released', async () => {
  const { sb, trip } = seedHold()
  sb._tables.payments.push({ id: 'fee-1', trip_id: trip.id, rider_id: user.id,
    kind: 'cancel_fee', status: 'succeeded', amount_cents: 500,
    stripe_payment_intent_id: 'pi_hold', idempotency_key: 'trip:trip-1:rider-1:cancel_fee:paid0:charge' })
  const stripe = fakeStripe({ status: 'succeeded' })
  const result = await settleTrip({ sb, stripe, trip, action: 'cancel', explicitAmountCents: 500 })
  assert.equal(result.http, 200)
  assert.equal(result.body.payment.idempotent, true)
  assert.equal(stripe.calls.length, 0)
  assert.equal(trip.metadata.fare_authorization.status, 'captured')
})

test('a released hold closes its pending payment row; captured rows are never touched', async () => {
  const { sb, trip } = seedHold()
  sb._tables.payments.push(
    { id: 'hold-row', trip_id: trip.id, rider_id: 'rider-1', kind: 'balance', status: 'pending', amount_cents: 2220,
      stripe_payment_intent_id: 'pi_hold', idempotency_key: `fare_auth:${trip.id}` },
    { id: 'other-row', trip_id: trip.id, rider_id: 'rider-1', kind: 'cancel_fee', status: 'succeeded', amount_cents: 500,
      stripe_payment_intent_id: 'pi_hold' },
  )
  const stripe = fakeStripe()
  const result = await settleTrip({ sb, stripe, trip: structuredClone(trip), action: 'cancel' })
  assert.equal(result.http, 200)
  assert.equal(trip.metadata.fare_authorization.status, 'canceled')
  const rows = Object.fromEntries(sb._tables.payments.map((row) => [row.id, row.status]))
  assert.deepEqual(rows, { 'hold-row': 'canceled', 'other-row': 'succeeded' })
  // A canceled trip that collected nothing is not marked paid.
  assert.notEqual(trip.payment_status, 'paid')
})

test('a hold released earlier still gets its payment row closed on the next release call', async () => {
  const { sb, trip } = seedHold('canceled')
  sb._tables.payments.push({ id: 'hold-row', trip_id: trip.id, rider_id: 'rider-1', kind: 'balance', status: 'pending',
    amount_cents: 2220, stripe_payment_intent_id: 'pi_hold' })
  const stripe = fakeStripe()
  const out = await releaseOpenFareHold({ sb, stripe, trip, reason: 'cancel_sweep' })
  assert.equal(out.skipped, true)
  assert.equal(cancels(stripe).length, 0)
  assert.equal(sb._tables.payments[0].status, 'canceled')
})
