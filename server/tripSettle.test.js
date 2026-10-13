import assert from 'node:assert/strict'
import test from 'node:test'
import { memoryCreditStore } from './credits.js'
import { isAdminUser, settleTrip as settleTripService } from './tripSettle.js'

import { tripCompletionDb } from '../tests/fixtures/tripCompletionDb.js'

async function settleTrip(options) {
  const sb = options.sb || tripCompletionDb(options.trip)
  sb.seedTrip?.(options.trip)
  return settleTripService({ ...options, sb, actor: options.actor || { id: options.trip?.driver_id } })
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

test('isAdminUser identifies admins across env var, roles, and flags', () => {
  const prevEnv = process.env.ADMIN_EMAILS
  try {
    process.env.ADMIN_EMAILS = 'lead@clemson.edu, ops-admin@clemson.edu'

    // Matches ADMIN_EMAILS (case insensitive)
    assert.equal(isAdminUser({ email: 'Lead@clemson.edu' }, null), true)
    assert.equal(isAdminUser({ email: 'ops-admin@clemson.edu' }, null), true)

    // Matches profile role
    assert.equal(isAdminUser({ email: 'other@clemson.edu' }, { role: 'admin' }), true)
    assert.equal(isAdminUser({ email: 'other@clemson.edu' }, { role: 'ops' }), true)

    // Matches profile is_admin flag
    assert.equal(isAdminUser({ email: 'other@clemson.edu' }, { is_admin: true }), true)

    // Regular student rider is false
    assert.equal(isAdminUser({ email: 'student@clemson.edu' }, { role: 'rider', is_admin: false }), false)

    // Empty/null inputs return false
    assert.equal(isAdminUser(null, null), false)
    assert.equal(isAdminUser({}, {}), false)
  } finally {
    if (prevEnv === undefined) {
      delete process.env.ADMIN_EMAILS
    } else {
      process.env.ADMIN_EMAILS = prevEnv
    }
  }
})

test('settleTrip rejects missing trip, invalid action, and unauthorized override', async () => {
  // Missing trip
  const noTrip = await settleTrip({ trip: null, action: 'complete' })
  assert.equal(noTrip.http, 404)
  assert.equal(noTrip.body.error, 'Trip not found')

  // Invalid action
  const badAction = await settleTrip({ trip: { id: 't1' }, action: 'refund' })
  assert.equal(badAction.http, 400)
  assert.equal(badAction.body.error, 'action must be complete, cancel, or charge')

  // Unauthorized admin override
  const unauth = await settleTrip({
    trip: { id: 't1' },
    action: 'complete',
    adminOverride: true,
    actor: { id: 'u1', email: 'regular@clemson.edu' },
  })
  assert.equal(unauth.http, 403)
  assert.equal(unauth.body.error, 'Admin override is not available for this account')
})

test('settleTrip complete blocks when fare is not set and cannot be priced', async () => {
  const sb = makeMockSb()
  const res = await settleTrip({
    sb,
    trip: {
      id: 'trip_unpriced',
      driver_id: 'd1',
      fare_cents: null,
      rider_id: 'r1',
      status: 'in_progress',
      metadata: {},
    },
    action: 'complete',
  })
  assert.equal(res.http, 409)
  assert.equal(res.body.code, 'fare_not_set')
  assert.equal(res.body.progressed, false)
})

test('settleTrip cancel returns fee_not_computed when fee is required but missing', async () => {
  const res = await settleTrip({
    trip: {
      id: 'trip_nofee',
      fare_cents: 2500,
      rider_id: 'r1',
      status: 'accepted',
      metadata: {},
    },
    action: 'cancel',
    requireFee: true,
  })
  assert.equal(res.http, 409)
  assert.equal(res.body.failure.code, 'fee_not_computed')
  assert.equal(res.body.progressed, false)
})

test('settleTrip blocks progression with 402 payment_required when card is declined', async () => {
  const deps = mockDeps({ cardDeclined: true })
  const sb = makeMockSb()
  const trip = {
    id: 'trip_declined',
    rider_id: 'r1',
    driver_id: 'd1',
    status: 'in_progress',
    fare_cents: 3500,
    metadata: {},
  }

  const res = await settleTrip({
    sb,
    trip,
    action: 'complete',
    deps,
  })

  assert.equal(res.http, 402)
  assert.equal(res.body.progressed, false)
  assert.equal(res.body.status, 'payment_required')
  assert.equal(res.body.tripStatus, 'in_progress')
  assert.equal(res.body.failure.code, 'card_declined')
  assert.equal(sb.updates.some(u => u.patch.status), false)
})

test('settleTrip completes a campus trip with no saved card and does not call Stripe', async () => {
  let intents = 0
  const deps = mockDeps({
    profile: { stripe_customer_id: null, stripe_default_pm_id: null },
  })
  const original = deps.createPaymentIntent
  deps.createPaymentIntent = async (params) => {
    intents += 1
    return original(params)
  }
  const sb = makeMockSb()
  const trip = {
    id: 'trip_campus_nocard',
    rider_id: 'r1',
    driver_id: 'd1',
    status: 'in_progress',
    fare_cents: 1800,
    deposit_cents: 0,
    metadata: { purpose: 'planned', match: 'open' },
  }
  const res = await settleTrip({ sb, trip, action: 'complete', deps })
  assert.equal(res.http, 200)
  assert.equal(res.body.progressed, true)
  assert.equal(res.body.status, 'completed')
  assert.equal(res.body.reason, 'no_card_on_file')
  assert.equal(intents, 0)
  assert.equal(deps.payments.length, 0)
  const tripUpdate = sb.updates.find((u) => u.patch.status === 'completed')
  assert.equal(tripUpdate.patch.metadata.remainder_uncollected, true)
  assert.equal(tripUpdate.patch.metadata.payment_hold, undefined)
  assert.equal(res.body.payout, null)
  assert.equal(sb.payouts.length, 0)
})

test('settleTrip does not attempt a payout when the campus fare was not collected', async () => {
  const transfers = []
  const stripe = {
    transfers: {
      create: async (params) => {
        transfers.push(params)
        return { id: 'tr_uncollected' }
      },
    },
  }
  const deps = mockDeps({
    profile: { stripe_customer_id: null, stripe_default_pm_id: null },
  })
  const sb = makeMockSb({ connectAccountId: 'acct_demo_driver' })
  const trip = {
    id: 'trip_campus_uncollected_payout',
    rider_id: 'r1',
    driver_id: 'd1',
    status: 'in_progress',
    fare_cents: 1800,
    deposit_cents: 0,
    metadata: { purpose: 'planned', match: 'open' },
  }
  const res = await settleTrip({ sb, stripe, trip, action: 'complete', deps })
  assert.equal(res.http, 200)
  assert.equal(res.body.progressed, true)
  assert.equal(res.body.status, 'completed')
  assert.equal(res.body.reason, 'no_card_on_file')
  assert.equal(res.body.payout, null)
  assert.equal(transfers.length, 0)
  assert.equal(sb.payouts.length, 0)
  assert.equal(deps.payments.length, 0)
})

test('settleTrip still blocks an existing airport deposit when no card is on file', async () => {
  let intents = 0
  const deps = mockDeps({
    profile: { stripe_customer_id: null, stripe_default_pm_id: null },
  })
  deps.createPaymentIntent = async () => {
    intents += 1
    return { id: 'pi_should_not', status: 'succeeded', amount: 1 }
  }
  const sb = makeMockSb()
  const trip = {
    id: 'trip_airport_deposit',
    rider_id: 'r1',
    driver_id: 'd1',
    status: 'in_progress',
    fare_cents: 4000,
    deposit_cents: 1000,
    metadata: { purpose: 'airport', airport: 'GSP' },
  }
  const transfers = []
  const stripe = {
    transfers: {
      create: async (params) => {
        transfers.push(params)
        return { id: 'tr_deposit_should_not' }
      },
    },
  }
  const res = await settleTrip({ sb, stripe, trip, action: 'complete', deps })
  assert.equal(res.http, 402)
  assert.equal(res.body.progressed, false)
  assert.equal(sb.updates.some(u => u.patch.status), false)
  assert.equal(intents, 0)
  assert.equal(transfers.length, 0)
  assert.equal(sb.payouts.length, 0)
})

test('settleTrip charge action charges without progressing trip lifecycle', async () => {
  const deps = mockDeps({ balance: 0 })
  const sb = makeMockSb()
  const trip = {
    id: 'trip_charge_only',
    rider_id: 'r1',
    driver_id: 'd1',
    status: 'in_progress',
    fare_cents: 2000,
    metadata: {},
  }

  const res = await settleTrip({
    sb,
    trip,
    action: 'charge',
    explicitAmountCents: 500,
    deps,
  })

  assert.equal(res.http, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.progressed, false)
  assert.equal(res.body.status, 'in_progress')
  assert.equal(res.body.payment.ok, true)
  assert.equal(deps.payments.length, 1)
  assert.equal(deps.payments[0].amount_cents, 500)
  // Trips table status was NOT transitioned to completed or canceled
  assert.equal(sb.updates.some((u) => u.patch.status === 'completed' || u.patch.status === 'canceled'), false)
  assert.equal(sb.events.length, 0)
})

test('settleTrip complete transitions trip, logs event, and triggers driver payout', async () => {
  const transfers = []
  const stripe = {
    transfers: {
      create: async (params) => {
        transfers.push(params)
        return { id: 'tr_collected' }
      },
    },
  }
  const deps = mockDeps({ balance: 0 })
  const sb = makeMockSb({ connectAccountId: 'acct_stripe_driver' })
  const trip = {
    id: 'trip_success',
    rider_id: 'r1',
    driver_id: 'd1',
    status: 'in_progress',
    fare_cents: 4000,
    metadata: {},
  }

  const res = await settleTrip({
    sb,
    stripe,
    trip,
    action: 'complete',
    deps,
  })

  assert.equal(res.http, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.progressed, true)
  assert.equal(res.body.status, 'completed')

  // Trip updated in DB
  const tripUpdate = sb.updates.find((u) => u.patch.status === 'completed')
  assert.ok(tripUpdate)
  assert.ok(tripUpdate.patch.completed_at)

  // Trip event recorded
  const completedEvent = sb.events.find((e) => e.kind === 'completed')
  assert.ok(completedEvent)
  assert.equal(completedEvent.trip_id, 'trip_success')
  assert.equal(completedEvent.payload.source, 'trip_settle')
  assert.equal(completedEvent.payload.amount_cents, 4000)

  // Saved card was charged, so the driver payout still runs.
  assert.equal(deps.payments.length, 1)
  assert.ok(res.body.payout)
  assert.equal(res.body.payout.amountCents, 3200) // 80% of 4000 fare
  assert.equal(transfers.length, 1)
  assert.equal(transfers[0].destination, 'acct_stripe_driver')
  assert.equal(transfers[0].amount, 3200)
})

test('settleTrip cancel transitions trip to canceled and logs event', async () => {
  const sb = makeMockSb()
  const trip = {
    id: 'trip_cancel_ok',
    rider_id: 'r1',
    status: 'accepted',
    fare_cents: 2500,
    metadata: {},
  }

  const res = await settleTrip({
    sb,
    trip,
    action: 'cancel',
    explicitAmountCents: 0,
  })

  assert.equal(res.http, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.progressed, true)
  assert.equal(res.body.status, 'canceled')

  const cancelUpdate = sb.updates.find((u) => u.patch.status === 'canceled')
  assert.ok(cancelUpdate)
  assert.ok(cancelUpdate.patch.canceled_at)

  const cancelEvent = sb.events.find((e) => e.kind === 'canceled')
  assert.ok(cancelEvent)
  assert.equal(cancelEvent.kind, 'canceled')

  // A $0 cancel is never recorded as paid.
  assert.ok(!sb.updates.some((u) => u.patch.payment_status === 'paid'))
  assert.ok(sb.updates.some((u) => u.patch.payment_status === 'no_charge'))
})

test('settleTrip debits stored ride credits once and pays the driver', async () => {
  const calls = []
  const store = memoryCreditStore({ r1: 5000 })
  const creditStore = {
    async applyCredits(userId, delta, meta) {
      calls.push({ userId, delta, meta })
      return store.applyCredits(userId, delta, meta)
    },
  }
  let intents = 0
  const deps = mockDeps({
    profile: { stripe_customer_id: null, stripe_default_pm_id: null },
  })
  deps.creditStore = creditStore
  deps.createPaymentIntent = async () => {
    intents += 1
    return { id: 'pi_should_not', status: 'succeeded', amount: 1 }
  }
  const transfers = []
  const stripe = {
    transfers: {
      create: async (params) => {
        transfers.push(params)
        return { id: 'tr_credits' }
      },
    },
  }
  const sb = makeMockSb({ connectAccountId: 'acct_credits_driver' })
  const trip = {
    id: 'trip_credits',
    rider_id: 'r1',
    driver_id: 'd1',
    status: 'in_progress',
    fare_cents: 1800,
    deposit_cents: 0,
    metadata: { purpose: 'planned', billing_choice: 'credits', billing_charged: false, billing_debited_cents: 0 },
  }
  const res = await settleTrip({ sb, stripe, trip, action: 'complete', deps })
  assert.equal(res.http, 200)
  assert.equal(res.body.progressed, true)
  assert.equal(res.body.status, 'completed')
  assert.equal(res.body.payment.method, 'credits')
  assert.equal(intents, 0)
  assert.equal(deps.payments.length, 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].delta, -1800)
  assert.equal(calls[0].meta.idempotencyKey, 'ride_credits:trip_credits')
  assert.equal(calls[0].meta.kind, 'ride_redemption')
  assert.equal((await store.getCredits('r1')).balanceCents, 3200)
  const tripUpdate = sb.updates.find((u) => u.patch.status === 'completed')
  assert.equal(tripUpdate.patch.metadata.billing_debited_cents, 1800)
  assert.equal(tripUpdate.patch.metadata.billing_charged, false)
  assert.equal(tripUpdate.patch.metadata.credits_settled, true)
  assert.equal(tripUpdate.patch.metadata.fare_paid_cents, 1800)
  assert.equal(tripUpdate.patch.metadata.remainder_uncollected, undefined)
  assert.equal(res.body.payout.amountCents, 1440)
  assert.equal(transfers.length, 1)

  const stale = await settleTrip({ sb, stripe, trip, action: 'complete', deps })
  assert.equal(stale.http, 200)
  assert.equal(stale.body.idempotent, true)
  assert.equal(stale.body.progressed, false)
  assert.equal(calls.length, 1)
  assert.equal((await store.getCredits('r1')).balanceCents, 3200)

  const stamped = {
    ...trip,
    metadata: tripUpdate.patch.metadata,
  }
  const replay = await settleTrip({ sb, stripe, trip: stamped, action: 'complete', deps })
  assert.equal(replay.http, 200)
  assert.equal(calls.length, 1)
  assert.equal((await store.getCredits('r1')).balanceCents, 3200)
})

test('settleTrip refuses to complete a credits ride when the balance is short', async () => {
  const calls = []
  const store = memoryCreditStore({ r1: 100 })
  const creditStore = {
    async applyCredits(userId, delta, meta) {
      calls.push({ userId, delta, meta })
      return store.applyCredits(userId, delta, meta)
    },
  }
  let intents = 0
  const deps = mockDeps({
    profile: { stripe_customer_id: null, stripe_default_pm_id: null },
  })
  deps.creditStore = creditStore
  deps.createPaymentIntent = async () => {
    intents += 1
    return { id: 'pi_should_not', status: 'succeeded', amount: 1 }
  }
  const transfers = []
  const stripe = {
    transfers: { create: async (params) => { transfers.push(params); return { id: 'tr_no' } } },
  }
  const sb = makeMockSb({ connectAccountId: 'acct_credits_driver' })
  const trip = {
    id: 'trip_credits_short',
    rider_id: 'r1',
    driver_id: 'd1',
    status: 'in_progress',
    fare_cents: 1800,
    metadata: { billing_choice: 'credits' },
  }
  const res = await settleTrip({ sb, stripe, trip, action: 'complete', deps })
  assert.equal(res.http, 402)
  assert.equal(res.body.progressed, false)
  assert.equal(res.body.failure.code, 'credits_insufficient')
  assert.equal(sb.updates.some((u) => u.patch.status === 'completed'), false)
  assert.equal(sb.payouts.length, 0)
  assert.equal(transfers.length, 0)
  assert.equal(intents, 0)
  assert.equal(calls.length, 1)
  assert.equal((await store.getCredits('r1')).balanceCents, 100)
})

test('settleTrip handles database update failure and event failure cleanly', async () => {
  // DB update failure
  const failingUpdateSb = makeMockSb({ tripUpdateError: { message: 'trips table lock timeout' } })
  const failRes = await settleTrip({
    sb: failingUpdateSb,
    trip: { id: 't_fail', rider_id: 'r1', driver_id: 'd1', status: 'in_progress', fare_cents: 0 },
    action: 'complete',
  })
  assert.equal(failRes.http, 500)
  assert.equal(failRes.body.error, 'trips table lock timeout')
  assert.equal(failRes.body.progressed, false)

  // DB event insert failure
  const failingEventSb = makeMockSb({ eventInsertError: { message: 'trip_events insert failed' } })
  const eventFailRes = await settleTrip({
    sb: failingEventSb,
    trip: { id: 't_event_fail', rider_id: 'r1', driver_id: 'd1', status: 'in_progress', fare_cents: 0 },
    action: 'complete',
  })
  assert.equal(eventFailRes.http, 500)
  assert.equal(eventFailRes.body.code, 'trip_event_failed')
  assert.equal(eventFailRes.body.progressed, true)
  assert.equal(eventFailRes.body.status, 'completed')
})
