import test from 'node:test'
import assert from 'node:assert/strict'
import { settleTrip } from '../server/tripSettle.js'
import handleReleaseScheduledBoost from '../server/endpoints/releaseScheduledBoost.js'

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader(key, val) {
      if (this.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT')
      this.headers[key.toLowerCase()] = val
    },
    end(chunk) {
      if (this.writableEnded) throw new Error('ERR_STREAM_ALREADY_ENDED')
      this.writableEnded = true
      this.headersSent = true
      if (chunk) this.body += String(chunk)
      return this
    },
  }
}

function parseJson(res) {
  try {
    return JSON.parse(res.body || '{}')
  } catch {
    return null
  }
}

function createSettleDb({ trip, profile = null }) {
  let currentTrip = { ...trip }
  const events = []
  const payouts = []

  const sb = {
    _trip: currentTrip,
    _events: events,
    _payouts: payouts,
    from(table) {
      if (table === 'trips') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { ...currentTrip }, error: null }),
            }),
          }),
          update: (patch) => ({
            eq: () => {
              Object.assign(currentTrip, patch)
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: profile || {
                  stripe_customer_id: 'cus_test_rider',
                  stripe_default_pm_id: 'pm_card_test',
                  stripe_account_id: 'acct_driver_test',
                },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'trip_events') {
        return {
          insert: async (event) => {
            events.push(event)
            return { error: null }
          },
        }
      }
      if (table === 'driver_payouts') {
        return {
          upsert: async (payout) => {
            payouts.push(payout)
            return { error: null }
          },
        }
      }
      if (table === 'payments') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: 'pay_1' }, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        }
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        insert: () => Promise.resolve({ data: null, error: null }),
      }
    },
  }
  return sb
}

test('settleTrip: captures Stripe pre-auth hold and enqueues driver payout on completion', async () => {
  const trip = {
    id: 't_preauth_success',
    rider_id: 'r_rider_1',
    driver_id: 'd_driver_1',
    fare_cents: 5000,
    status: 'in_progress',
    metadata: {
      driver_net_cents: 4000,
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_hold_success',
        authorizationCents: 5000,
      },
    },
  }

  let capturedAmount = null
  const mockStripe = {
    paymentIntents: {
      capture: async (piId, params) => {
        capturedAmount = params.amount_to_capture
        return { id: piId, status: 'succeeded', amount_received: params.amount_to_capture }
      },
      retrieve: async () => ({ status: 'requires_capture' }),
    },
    transfers: {
      create: async () => ({ id: 'tr_test_payout_1' }),
    },
  }

  const sb = createSettleDb({ trip })
  const res = await settleTrip({
    sb,
    stripe: mockStripe,
    trip,
    action: 'complete',
  })

  assert.equal(res.http, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.progressed, true)
  assert.equal(res.body.status, 'completed')
  assert.equal(capturedAmount, 5000)
  assert.equal(res.body.payment.ok, true)
  assert.equal(res.body.payment.method, 'card')
  assert.equal(sb._trip.status, 'completed')
  assert.equal(sb._events.some((e) => e.kind === 'completed'), true)
  assert.equal(res.body.payout.ok, true)
})

test('settleTrip: blocks progression with 402 payment_required when hold capture fails', async () => {
  const trip = {
    id: 't_preauth_fail',
    rider_id: 'r_rider_fail',
    driver_id: 'd_driver_1',
    fare_cents: 6000,
    status: 'in_progress',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_hold_fail',
        authorizationCents: 6000,
      },
    },
  }

  const mockStripeFailing = {
    paymentIntents: {
      capture: async () => {
        const err = new Error('Your card was declined')
        err.code = 'card_declined'
        throw err
      },
      retrieve: async () => ({ status: 'requires_capture' }),
    },
  }

  const sb = createSettleDb({ trip })
  const res = await settleTrip({
    sb,
    stripe: mockStripeFailing,
    trip,
    action: 'complete',
  })

  assert.equal(res.http, 402)
  assert.equal(res.body.progressed, false)
  assert.equal(res.body.status, 'payment_required')
  assert.equal(res.body.tripStatus, 'in_progress')
  assert.match(res.body.error, /declined|charge_failed|Payment required/i)
  assert.equal(sb._trip.status, 'in_progress') // Not completed
})

test('settleTrip: captures boost amount together with fare on boosted scheduled trips', async () => {
  const trip = {
    id: 't_preauth_boost',
    rider_id: 'r_rider_boost',
    driver_id: 'd_driver_1',
    fare_cents: 4000,
    boost_cents: 1500,
    status: 'in_progress',
    metadata: {
      boost_cents: 1500,
      scheduled_boost_cents: 1500,
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_hold_boost',
        authorizationCents: 5500, // Preauthorized fare 4000 + boost 1500
      },
    },
  }

  let capturedAmount = null
  const mockStripe = {
    paymentIntents: {
      capture: async (piId, params) => {
        capturedAmount = params.amount_to_capture
        return { id: piId, status: 'succeeded', amount_received: params.amount_to_capture }
      },
      retrieve: async () => ({ status: 'requires_capture' }),
    },
    transfers: {
      create: async () => ({ id: 'tr_test_boost_1' }),
    },
  }

  const sb = createSettleDb({ trip })
  const res = await settleTrip({
    sb,
    stripe: mockStripe,
    trip,
    action: 'complete',
  })

  assert.equal(res.http, 200)
  assert.equal(res.body.ok, true)
  assert.equal(capturedAmount, 5500) // 4000 fare + 1500 boost
  assert.equal(sb._trip.status, 'completed')
})

test('settleTrip: credits billing choice captures only boost via hold and debits fare from credits', async () => {
  const trip = {
    id: 't_preauth_credits_boost',
    rider_id: 'r_rider_cr',
    driver_id: 'd_driver_1',
    fare_cents: 3500,
    boost_cents: 1000,
    status: 'in_progress',
    metadata: {
      billing_choice: 'credits',
      boost_cents: 1000,
      scheduled_boost_cents: 1000,
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_hold_cr_boost',
        authorizationCents: 4500,
      },
    },
  }

  let capturedAmount = null
  const mockStripe = {
    paymentIntents: {
      capture: async (piId, params) => {
        capturedAmount = params.amount_to_capture
        return { id: piId, status: 'succeeded', amount_received: params.amount_to_capture }
      },
      retrieve: async () => ({ status: 'requires_capture' }),
    },
    transfers: {
      create: async () => ({ id: 'tr_test_cr_1' }),
    },
  }

  const mockCreditStore = {
    applyCredits: async () => ({ ok: true, balanceCents: 5000 }),
    getBalance: async () => 8500,
  }

  const sb = createSettleDb({ trip })
  const res = await settleTrip({
    sb,
    stripe: mockStripe,
    trip,
    action: 'complete',
    deps: { creditStore: mockCreditStore },
  })

  assert.equal(res.http, 200)
  assert.equal(res.body.ok, true)
  assert.equal(capturedAmount, 1000) // ONLY boost 1000 captured from card hold!
  assert.equal(sb._trip.status, 'completed')
  assert.equal(sb._trip.metadata.credits_settled, true)
  assert.equal(sb._trip.metadata.billing_debited_cents, 3500)
})

test('settleTrip: handles unexpected exception in settleFareHold gracefully with 402', async () => {
  const trip = {
    id: 't_preauth_crash',
    rider_id: 'r_rider_crash',
    driver_id: 'd_driver_1',
    fare_cents: 5000,
    status: 'in_progress',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_crash',
      },
    },
  }

  const mockStripeCrashing = {
    paymentIntents: {
      capture: () => {
        throw new Error('Stripe API gateway timeout 504')
      },
      retrieve: async () => ({ status: 'requires_capture' }),
    },
  }

  const sb = createSettleDb({ trip })
  const res = await settleTrip({
    sb,
    stripe: mockStripeCrashing,
    trip,
    action: 'complete',
  })

  assert.equal(res.http, 402)
  assert.equal(res.body.progressed, false)
  assert.equal(res.body.status, 'payment_required')
})

test('handleReleaseScheduledBoost: validates method, auth, rider isolation, status lock, and Stripe release', async () => {
  // 1. Method 405
  const res405 = mockRes()
  await handleReleaseScheduledBoost({ method: 'GET' }, res405, {})
  assert.equal(res405.statusCode, 405)

  // 2. Missing sb 503
  const res503 = mockRes()
  await handleReleaseScheduledBoost({ method: 'POST', body: { tripId: 't1' } }, res503, { sb: null })
  assert.equal(res503.statusCode, 503)

  // 3. Unauth 401
  const res401 = mockRes()
  await handleReleaseScheduledBoost({ method: 'POST', body: { tripId: 't1' } }, res401, { sb: {}, user: null })
  assert.equal(res401.statusCode, 401)

  // 4. Missing tripId 400
  const resNoTrip = mockRes()
  await handleReleaseScheduledBoost({ method: 'POST', body: { tripId: '   ' } }, resNoTrip, { sb: {}, user: { id: 'u1' } })
  assert.equal(resNoTrip.statusCode, 400)

  // 5. Cross-account access 404
  const tripOther = { id: 't_other', rider_id: 'other_user', status: 'scheduled', metadata: {} }
  const sbOther = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: tripOther, error: null }),
        }),
      }),
    }),
  }
  const res404 = mockRes()
  await handleReleaseScheduledBoost(
    { method: 'POST', body: { tripId: 't_other' } },
    res404,
    { sb: sbOther, user: { id: 'u_mine' } },
  )
  assert.equal(res404.statusCode, 404)

  // 6. Ride already locked (status: completed) returns 409 boost_hold_locked
  const tripLocked = { id: 't_lock', rider_id: 'u_mine', status: 'completed', metadata: {} }
  const sbLocked = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: tripLocked, error: null }),
        }),
      }),
    }),
  }
  const res409 = mockRes()
  await handleReleaseScheduledBoost(
    { method: 'POST', body: { tripId: 't_lock' } },
    res409,
    { sb: sbLocked, user: { id: 'u_mine' } },
  )
  assert.equal(res409.statusCode, 409)
  assert.equal(parseJson(res409).code, 'boost_hold_locked')

  // 7. Ride with 0 boost skips release with 200 { skipped: true, reason: 'no_boost' }
  const tripNoBoost = { id: 't_noboost', rider_id: 'u_mine', status: 'scheduled', metadata: { scheduled_boost_cents: 0 } }
  const sbNoBoost = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: tripNoBoost, error: null }),
        }),
      }),
    }),
  }
  const resNoBoost = mockRes()
  await handleReleaseScheduledBoost(
    { method: 'POST', body: { tripId: 't_noboost' } },
    resNoBoost,
    { sb: sbNoBoost, user: { id: 'u_mine' } },
  )
  assert.equal(resNoBoost.statusCode, 200)
  assert.equal(parseJson(resNoBoost).skipped, true)
  assert.equal(parseJson(resNoBoost).reason, 'no_boost')

  // 8. Ride with boost successfully releases hold
  const tripBoost = {
    id: 't_boost_release',
    rider_id: 'u_mine',
    status: 'scheduled',
    boost_cents: 1000,
    metadata: {
      boost_cents: 1000,
      scheduled_boost_cents: 1000,
      fare_authorization: { status: 'requires_capture', paymentIntentId: 'pi_test_release' },
    },
  }
  const sbBoost = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: tripBoost, error: null }),
        }),
      }),
    }),
  }
  let releasedCalled = false
  const fakeReleaseFn = async () => {
    releasedCalled = true
    return { ok: true, released: true }
  }
  const resSuccess = mockRes()
  await handleReleaseScheduledBoost(
    { method: 'POST', body: { tripId: 't_boost_release' } },
    resSuccess,
    { sb: sbBoost, user: { id: 'u_mine' }, releaseOpenFareHold: fakeReleaseFn },
  )
  assert.equal(resSuccess.statusCode, 200)
  assert.equal(releasedCalled, true)
  assert.equal(parseJson(resSuccess).ok, true)

  // 9. When releaseOpenFareHold fails, returns 502 hold_release_failed
  const fakeReleaseFailing = async () => {
    return { ok: false, error: 'Stripe gateway unreachable' }
  }
  const res502 = mockRes()
  await handleReleaseScheduledBoost(
    { method: 'POST', body: { tripId: 't_boost_release' } },
    res502,
    { sb: sbBoost, user: { id: 'u_mine' }, releaseOpenFareHold: fakeReleaseFailing },
  )
  assert.equal(res502.statusCode, 502)
  assert.equal(parseJson(res502).code, 'hold_release_failed')
})
