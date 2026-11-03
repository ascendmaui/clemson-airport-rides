import test from 'node:test'
import assert from 'node:assert/strict'
import {
  releaseOpenFareHold,
  settleFareHold,
  placeFareAuthorization,
  authorizeRideRequest,
  syncBoostAuthorization,
} from '../server/fareAuthorization.js'
import {
  settleSwitchHold,
} from '../server/riderSwitchHold.js'

function createMemoryDb(seed = {}) {
  const initial = Array.isArray(seed) ? { trips: seed } : (seed || {})
  const tables = {
    profiles: [
      { id: 'rider_retry', stripe_customer_id: 'cus_retry', stripe_default_pm_id: 'pm_primary' },
      { id: 'rider_backup', stripe_customer_id: 'cus_backup', stripe_default_pm_id: 'pm_primary' },
      ...(initial.profiles || []),
    ],
    trips: [...(initial.trips || [])],
    payments: [...(initial.payments || [])],
  }

  function from(table) {
    if (!tables[table]) tables[table] = []
    const rows = tables[table]
    const state = { op: 'select', filters: [], payload: null }

    function run(one) {
      const matches = (row) => state.filters.every(([col, val]) => row[col] === val)
      if (state.op === 'insert') {
        const row = { id: state.payload?.id || `${table}_${rows.length + 1}`, ...(state.payload || {}) }
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

  return {
    tables,
    from,
    get _trips() { return tables.trips },
    get _payments() { return tables.payments },
    get _profiles() { return tables.profiles },
  }
}

test('releaseOpenFareHold: skips gracefully when no hold exists or already completed/canceled', async () => {
  // 1. Missing trip metadata
  const resNoMeta = await releaseOpenFareHold({ trip: { id: 't_none' } })
  assert.equal(resNoMeta.ok, true)
  assert.equal(resNoMeta.skipped, true)
  assert.equal(resNoMeta.reason, 'no_open_hold')

  // 2. Status is already captured
  const resCaptured = await releaseOpenFareHold({
    trip: {
      id: 't_cap',
      metadata: {
        fare_authorization: { status: 'captured', paymentIntentId: 'pi_test_cap' },
      },
    },
  })
  assert.equal(resCaptured.ok, true)
  assert.equal(resCaptured.skipped, true)
  assert.equal(resCaptured.reason, 'no_open_hold')

  // 3. Stripe unconfigured
  const resNoStripe = await releaseOpenFareHold({
    trip: {
      id: 't_nostripe',
      metadata: {
        fare_authorization: { status: 'requires_capture', paymentIntentId: 'pi_test_open' },
      },
    },
    stripe: null,
  })
  assert.equal(resNoStripe.ok, true)
  assert.equal(resNoStripe.skipped, true)
  assert.equal(resNoStripe.reason, 'stripe_not_configured')
})

test('releaseOpenFareHold: cancels PaymentIntent and updates trip metadata on success and handles cancel failure', async () => {
  const trip = {
    id: 't_rel',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_rel',
        authorizationCents: 5000,
      },
    },
  }

  // Cancel failure
  const failingStripe = {
    paymentIntents: {
      cancel: async () => {
        throw new Error('Stripe network timeout')
      },
    },
  }
  const failRes = await releaseOpenFareHold({
    trip,
    stripe: failingStripe,
    sb: createMemoryDb([trip]),
  })
  assert.equal(failRes.ok, false)
  assert.equal(failRes.reason, 'hold_release_failed')
  assert.equal(failRes.paymentIntentId, 'pi_test_rel')

  // Cancel success
  let canceledId = null
  const successStripe = {
    paymentIntents: {
      cancel: async (id) => {
        canceledId = id
        return { id, status: 'canceled' }
      },
    },
  }
  const sb = createMemoryDb([trip])
  const succRes = await releaseOpenFareHold({
    trip,
    stripe: successStripe,
    sb,
    reason: 'scheduled_cancel',
  })
  assert.equal(succRes.ok, true)
  assert.equal(succRes.released, true)
  assert.equal(succRes.reason, 'scheduled_cancel')
  assert.equal(canceledId, 'pi_test_rel')

  const updatedTrip = sb._trips[0]
  assert.equal(updatedTrip.metadata.fare_authorization.status, 'canceled')
  assert.equal(updatedTrip.metadata.fare_authorization.reason, 'scheduled_cancel')
})

test('settleFareHold: cancels hold quietly and returns null when trip is paid in credits with no boost', async () => {
  const trip = {
    id: 't_credits',
    metadata: {
      billing_choice: 'credits',
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_cred',
        authorizationCents: 4000,
      },
    },
  }

  let canceledId = null
  const stripe = {
    paymentIntents: {
      retrieve: async () => ({ id: 'pi_test_cred', status: 'requires_capture' }),
      cancel: async (id) => {
        canceledId = id
        return { id, status: 'canceled' }
      },
    },
  }
  const sb = createMemoryDb([trip])

  const result = await settleFareHold({
    sb,
    stripe,
    trip,
    finalFareCents: 3500,
  })

  assert.equal(result, null)
  assert.equal(canceledId, 'pi_test_cred')
  assert.equal(sb._trips[0].metadata.fare_authorization.status, 'canceled')
  assert.equal(sb._trips[0].metadata.fare_authorization.reason, 'credits')
})

test('settleFareHold: retries on first transient capture failure and succeeds on retry', async () => {
  const trip = {
    id: 't_retry_cap',
    rider_id: 'rider_retry',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_retry',
        authorizationCents: 5000,
      },
    },
  }

  let attempts = 0
  const stripe = {
    paymentIntents: {
      retrieve: async () => ({ id: 'pi_test_retry', status: 'requires_capture' }),
      capture: async (id, params, opts) => {
        attempts += 1
        if (attempts === 1) {
          const err = new Error('Rate limit exceeded')
          err.code = 'rate_limit'
          throw err
        }
        return { id, status: 'succeeded', amount_received: params.amount_to_capture }
      },
    },
    paymentMethods: { list: async () => ({ data: [] }) },
  }
  const sb = createMemoryDb([trip])

  const result = await settleFareHold({
    sb,
    stripe,
    trip,
    finalFareCents: 4500,
  })

  assert.equal(result.ok, true)
  assert.equal(result.status, 'succeeded')
  assert.equal(result.amountCents, 4500)
  assert.equal(attempts, 2)
  assert.equal(sb._trips[0].metadata.fare_authorization.status, 'captured')
})

test('settleFareHold: when capture fails completely and fallback backup card succeeds, captures via replacement', async () => {
  const trip = {
    id: 't_backup_card',
    rider_id: 'rider_backup',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_original',
        authorizationCents: 5000,
      },
    },
  }

  let canceledOriginal = null
  let replacementCreated = null

  const stripe = {
    paymentIntents: {
      retrieve: async () => ({ id: 'pi_test_original', status: 'requires_capture' }),
      capture: async () => {
        const err = new Error('Stolen card')
        err.code = 'card_declined'
        throw err
      },
      cancel: async (id) => {
        canceledOriginal = id
        return { id, status: 'canceled' }
      },
      create: async (params) => {
        replacementCreated = params
        if (params.payment_method === 'pm_primary') {
          const err = new Error('Card declined')
          err.code = 'card_declined'
          throw err
        }
        return { id: 'pi_test_replacement', status: 'succeeded', amount: params.amount }
      },
    },
    paymentMethods: {
      list: async () => ({ data: [{ id: 'pm_primary' }, { id: 'pm_backup_secondary' }] }),
    },
  }
  const sb = createMemoryDb([trip])

  const result = await settleFareHold({
    sb,
    stripe,
    trip,
    finalFareCents: 4800,
  })

  assert.equal(result.ok, true)
  assert.equal(result.paymentIntentId, 'pi_test_replacement')
  assert.equal(result.amountCents, 4800)
  assert.equal(result.backupCard, true)
  assert.equal(canceledOriginal, 'pi_test_original')
  assert.equal(replacementCreated.payment_method, 'pm_backup_secondary')
})

test('settleSwitchHold: handles hold=release, hold=place, and hold=grow scenarios correctly', async () => {
  const trip = {
    id: 't_switch_hold',
    fare_cents: 2000,
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_test_switch',
        authorizationCents: 2400,
      },
    },
  }

  // 1. hold = 'release' with Stripe cancel
  let canceled = false
  const stripeRelease = {
    paymentIntents: {
      cancel: async (id) => {
        assert.equal(id, 'pi_test_switch')
        canceled = true
        return { id, status: 'canceled' }
      },
    },
  }
  const sb = createMemoryDb([trip])
  sb._payments.push({
    trip_id: 't_switch_hold',
    stripe_payment_intent_id: 'pi_test_switch',
    status: 'pending',
  })

  const releaseRes = await settleSwitchHold({
    stripe: stripeRelease,
    sb,
    trip,
    quote: { hold: 'release' },
    riderId: 'rider_1',
  })
  assert.equal(releaseRes.ok, true)
  assert.equal(canceled, true)
  assert.equal(releaseRes.patch.fare_authorization.status, 'canceled')
  assert.equal(sb._payments[0].status, 'canceled')

  // 2. hold = 'grow' with incrementAuthorization
  let incrementedAmount = null
  const stripeGrow = {
    paymentIntents: {
      incrementAuthorization: async (id, params) => {
        incrementedAmount = params.amount
        return { id, status: 'requires_capture' }
      },
    },
  }

  const growRes = await settleSwitchHold({
    stripe: stripeGrow,
    sb,
    trip,
    quote: { hold: 'grow' },
    fareCents: 3000, // New higher fare -> auth 3600
  })
  assert.equal(growRes.ok, true)
  assert.equal(incrementedAmount, 3600)
  assert.equal(growRes.patch.fare_authorization.authorizationCents, 3600)

  // 3. hold = 'place' without customer/payment method -> parks outstanding balance
  const placeNoPmRes = await settleSwitchHold({
    stripe: { paymentIntents: { create: async () => ({}) } },
    sb,
    trip: { id: 't_new', fare_cents: 2000, metadata: {} },
    quote: { hold: 'place' },
    customerId: null,
    paymentMethodId: null,
    fareCents: 2000,
  })
  assert.equal(placeNoPmRes.ok, true)
  assert.equal(placeNoPmRes.patch.outstanding_balance.code, 'no_payment_method')
  assert.equal(placeNoPmRes.patch.outstanding_balance.reason, 'authorization_failed')
})

test('placeFareAuthorization: handles zero fare, unconfigured stripe, missing payment method, and success path', async () => {
  // 1. Zero fare
  const resZero = await placeFareAuthorization({ estimatedFareCents: 0, boostCents: 0 })
  assert.equal(resZero.ok, true)
  assert.equal(resZero.skipped, true)
  assert.equal(resZero.reason, 'zero_fare')

  // 2. Stripe unconfigured
  const resNoStripe = await placeFareAuthorization({ estimatedFareCents: 2000, stripe: null })
  assert.equal(resNoStripe.ok, true)
  assert.equal(resNoStripe.skipped, true)
  assert.equal(resNoStripe.reason, 'stripe_not_configured')

  // 3. Missing customerId / paymentMethodId parks outstanding balance
  const resNoPm = await placeFareAuthorization({
    stripe: { paymentIntents: { create: async () => ({}) } },
    tripId: 't_nopm',
    riderId: 'r_nopm',
    customerId: null,
    paymentMethodId: null,
    estimatedFareCents: 2500,
  })
  assert.equal(resNoPm.ok, false)
  assert.equal(resNoPm.parked, true)
  assert.equal(resNoPm.outstanding.code, 'no_payment_method')

  // 4. Success path records payment row
  let createdParams = null
  const stripe = {
    paymentIntents: {
      create: async (params) => {
        createdParams = params
        return { id: 'pi_place_ok', status: 'requires_capture' }
      },
    },
  }
  const sb = createMemoryDb()
  const resSuccess = await placeFareAuthorization({
    stripe,
    sb,
    tripId: 't_placed',
    riderId: 'r_placed',
    customerId: 'cus_placed',
    paymentMethodId: 'pm_placed',
    estimatedFareCents: 2000,
    boostCents: 500,
  })
  assert.equal(resSuccess.ok, true)
  assert.equal(resSuccess.authorization.status, 'requires_capture')
  assert.equal(resSuccess.authorization.paymentIntentId, 'pi_place_ok')
  assert.equal(createdParams.customer, 'cus_placed')
  assert.equal(createdParams.payment_method, 'pm_placed')
  assert.equal(sb._payments.length, 1)
  assert.equal(sb._payments[0].stripe_payment_intent_id, 'pi_place_ok')
})

test('authorizeRideRequest: skips for credits-only bookings and places hold for card trips', async () => {
  // 1. Credits trip without boost skips
  const creditsTrip = {
    id: 't_cred_trip',
    fare_cents: 2000,
    metadata: { billing_choice: 'credits' },
  }
  const resCredits = await authorizeRideRequest({
    trip: creditsTrip,
    riderId: 'rider_1',
  })
  assert.equal(resCredits.ok, true)
  assert.equal(resCredits.skipped, true)
  assert.equal(resCredits.reason, 'credits')

  // 2. Card trip with profile places hold and updates trip metadata
  const cardTrip = {
    id: 't_card_trip',
    fare_cents: 3000,
    rider_id: 'rider_retry',
    metadata: {},
  }
  const stripe = {
    paymentIntents: {
      create: async () => ({ id: 'pi_req_auth', status: 'requires_capture' }),
    },
    paymentMethods: { list: async () => ({ data: [] }) },
  }
  const sb = createMemoryDb([cardTrip])
  const resCard = await authorizeRideRequest({
    sb,
    stripe,
    trip: cardTrip,
    riderId: 'rider_retry',
  })
  assert.equal(resCard.ok, true)
  assert.equal(resCard.authorization.paymentIntentId, 'pi_req_auth')
  assert.equal(sb._trips[0].metadata.fare_authorization.paymentIntentId, 'pi_req_auth')
})

test('syncBoostAuthorization: handles no hold, existing coverage, increment, and reauthorization fallback', async () => {
  // 1. No open hold
  const noHoldTrip = { id: 't_nohold', metadata: {} }
  const resNoHold = await syncBoostAuthorization({ trip: noHoldTrip, boostCents: 500 })
  assert.equal(resNoHold.ok, true)
  assert.equal(resNoHold.skipped, true)
  assert.equal(resNoHold.reason, 'no_open_hold')

  // 2. Existing hold already covers
  const coveredTrip = {
    id: 't_covered',
    fare_cents: 2000,
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_cov',
        authorizationCents: 5000,
        estimatedFareCents: 2000,
      },
    },
  }
  const stripe = { paymentIntents: { retrieve: async () => ({ id: 'pi_cov' }) } }
  const resCovered = await syncBoostAuthorization({ stripe, trip: coveredTrip, boostCents: 100 })
  assert.equal(resCovered.ok, true)
  assert.equal(resCovered.skipped, true)
  assert.equal(resCovered.reason, 'hold_already_covers')

  // 3. Increment supported
  let incrementedAmt = 0
  const incStripe = {
    paymentIntents: {
      incrementAuthorization: async (id, params) => {
        incrementedAmt = params.amount
        return { id, status: 'requires_capture' }
      },
    },
  }
  const sbInc = createMemoryDb([coveredTrip])
  const resInc = await syncBoostAuthorization({
    sb: sbInc,
    stripe: incStripe,
    trip: coveredTrip,
    boostCents: 4000, // Quote will exceed 5000
  })
  assert.equal(resInc.ok, true)
  assert.equal(resInc.method, 'increment')
  assert.ok(incrementedAmt > 5000)

  // 4. Reauthorization fallback when increment not supported
  let canceledId = null
  let createdNewId = null
  const reauthStripe = {
    paymentIntents: {
      cancel: async (id) => {
        canceledId = id
        return { id, status: 'canceled' }
      },
      create: async () => {
        createdNewId = 'pi_new_reauth'
        return { id: 'pi_new_reauth', status: 'requires_capture' }
      },
    },
    paymentMethods: { list: async () => ({ data: [] }) },
  }
  const reauthTrip = {
    id: 't_reauth',
    rider_id: 'rider_retry',
    fare_cents: 2000,
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_old_reauth',
        authorizationCents: 2500,
        estimatedFareCents: 2000,
      },
    },
  }
  const sbReauth = createMemoryDb([reauthTrip])
  const resReauth = await syncBoostAuthorization({
    sb: sbReauth,
    stripe: reauthStripe,
    trip: reauthTrip,
    boostCents: 2000,
  })
  assert.equal(resReauth.ok, true)
  assert.equal(resReauth.method, 'reauth')
  assert.equal(canceledId, 'pi_old_reauth')
  assert.equal(createdNewId, 'pi_new_reauth')
  assert.equal(sbReauth._trips[0].metadata.fare_authorization.paymentIntentId, 'pi_new_reauth')
})

test('settleFareHold: returns succeeded immediately if paymentIntent was already succeeded on retrieval', async () => {
  const trip = {
    id: 't_already_succeeded',
    rider_id: 'rider_retry',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_already_succeeded',
        authorizationCents: 3000,
      },
    },
  }
  const stripe = {
    paymentIntents: {
      retrieve: async (id) => ({
        id,
        status: 'succeeded',
        amount: 3000,
        amount_received: 3000,
      }),
    },
  }
  const sb = createMemoryDb([trip])
  const result = await settleFareHold({
    sb,
    stripe,
    trip,
    finalFareCents: 3000,
  })
  assert.equal(result.ok, true)
  assert.equal(result.method, 'card')
  assert.equal(result.amountCents, 3000)
  assert.equal(result.paymentIntentId, 'pi_already_succeeded')
  assert.equal(result.status, 'succeeded')
  assert.equal(sb._trips[0].metadata.fare_authorization.status, 'captured')
  assert.equal(sb._trips[0].metadata.fare_authorization.capturedCents, 3000)
})

test('settleFareHold: cancels hold quietly and returns zero_due when final fare is zero or waived when below minimum', async () => {
  let canceledId = null
  const stripe = {
    paymentIntents: {
      retrieve: async (id) => ({ id, status: 'requires_capture' }),
      cancel: async (id) => {
        canceledId = id
        return { id, status: 'canceled' }
      },
    },
  }

  // 1. Zero due
  const zeroTrip = {
    id: 't_zero_fare',
    rider_id: 'rider_retry',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_cancel_zero',
        authorizationCents: 2000,
      },
    },
  }
  const sbZero = createMemoryDb([zeroTrip])
  const zeroRes = await settleFareHold({
    sb: sbZero,
    stripe,
    trip: zeroTrip,
    finalFareCents: 0,
  })
  assert.equal(zeroRes.ok, true)
  assert.equal(zeroRes.method, 'none')
  assert.equal(zeroRes.reason, 'zero_due')
  assert.equal(zeroRes.amountCents, 0)
  assert.equal(canceledId, 'pi_cancel_zero')
  assert.equal(sbZero._trips[0].metadata.fare_authorization.status, 'canceled')

  // 2. Waived below minimum (< 50 cents)
  const waiveTrip = {
    id: 't_waive_fare',
    rider_id: 'rider_retry',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_waive_min',
        authorizationCents: 2000,
      },
    },
  }
  const sbWaive = createMemoryDb([waiveTrip])
  const waiveRes = await settleFareHold({
    sb: sbWaive,
    stripe,
    trip: waiveTrip,
    finalFareCents: 35, // 35 cents is < MIN_CARD_CHARGE_CENTS (50)
  })
  assert.equal(waiveRes.ok, true)
  assert.equal(waiveRes.method, 'none')
  assert.equal(waiveRes.reason, 'below_minimum')
  assert.equal(waiveRes.amountCents, 0)
  assert.equal(canceledId, 'pi_waive_min')
  assert.equal(sbWaive._trips[0].metadata.fare_authorization.status, 'waived')
})

test('settleFareHold: increments authorization when final fare exceeds hold and captures incremented amount', async () => {
  const trip = {
    id: 't_increment_hold',
    rider_id: 'rider_retry',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_inc_hold',
        authorizationCents: 3000,
      },
    },
  }
  let incrementedAmt = 0
  let capturedAmt = 0
  const stripe = {
    paymentIntents: {
      retrieve: async (id) => ({ id, status: 'requires_capture', amount: 3000 }),
      incrementAuthorization: async (id, params) => {
        incrementedAmt = params.amount
        return { id, status: 'requires_capture', amount: params.amount }
      },
      capture: async (id, params) => {
        capturedAmt = params.amount_to_capture
        return { id, status: 'succeeded', amount_received: params.amount_to_capture }
      },
    },
    paymentMethods: { list: async () => ({ data: [] }) },
  }
  const sb = createMemoryDb([trip])
  const result = await settleFareHold({
    sb,
    stripe,
    trip,
    finalFareCents: 4200,
  })
  assert.equal(result.ok, true)
  assert.equal(result.method, 'card')
  assert.equal(result.amountCents, 4200)
  assert.equal(incrementedAmt, 4200)
  assert.equal(capturedAmt, 4200)
  assert.equal(sb._trips[0].metadata.fare_authorization.status, 'captured')
  assert.equal(sb._trips[0].metadata.fare_authorization.capturedCents, 4200)
})

test('settleFareHold: handles overage when final fare exceeds captured hold, covering both successful and failed overage charges', async () => {
  // Case A: Successful overage charge
  const tripOk = {
    id: 't_overage_ok',
    rider_id: 'rider_retry',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_main_ok',
        authorizationCents: 3000,
      },
    },
  }
  let overageCreated = null
  const stripeOkClient = {
    paymentIntents: {
      retrieve: async (id) => ({ id, status: 'requires_capture', amount: 3000 }),
      capture: async (id, params) => ({
        id,
        status: 'succeeded',
        amount_received: 3000, // Captured only 3000
      }),
      create: async (params) => {
        overageCreated = params
        return { id: 'pi_overage_extra', status: 'succeeded', amount: params.amount }
      },
    },
    paymentMethods: { list: async () => ({ data: [] }) },
  }
  const sbOk = createMemoryDb([tripOk])
  const resOk = await settleFareHold({
    sb: sbOk,
    stripe: stripeOkClient,
    trip: tripOk,
    finalFareCents: 4000, // 4000 > 3000 -> 1000 overage
  })
  assert.equal(resOk.ok, true)
  assert.equal(resOk.amountCents, 4000)
  assert.equal(resOk.paymentIntentId, 'pi_main_ok')
  assert.equal(resOk.overagePaymentIntentId, 'pi_overage_extra')
  assert.equal(overageCreated.amount, 1000)
  assert.equal(sbOk._trips[0].metadata.fare_authorization.overagePaymentIntentId, 'pi_overage_extra')

  // Case B: Failed overage charge parks outstanding balance and marks partial capture
  const tripFail = {
    id: 't_overage_fail',
    rider_id: 'rider_retry',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_main_fail',
        authorizationCents: 3000,
      },
    },
  }
  const stripeFailClient = {
    paymentIntents: {
      retrieve: async (id) => ({ id, status: 'requires_capture', amount: 3000 }),
      capture: async (id, params) => ({
        id,
        status: 'succeeded',
        amount_received: 3000,
      }),
      create: async () => {
        const err = new Error('Insufficient funds')
        err.code = 'card_declined'
        throw err
      },
    },
    paymentMethods: { list: async () => ({ data: [] }) },
  }
  const sbFail = createMemoryDb([tripFail])
  const resFail = await settleFareHold({
    sb: sbFail,
    stripe: stripeFailClient,
    trip: tripFail,
    finalFareCents: 4500, // 4500 > 3000 -> 1500 overage
  })
  assert.equal(resFail.ok, false)
  assert.equal(resFail.parked, true)
  assert.equal(resFail.capturedCents, 3000)
  assert.equal(resFail.outstanding.amountCents, 1500)
  assert.equal(resFail.outstanding.reason, 'overage_failed')
  assert.equal(sbFail._trips[0].metadata.fare_authorization.status, 'partial')
  assert.equal(sbFail._trips[0].metadata.outstanding_balance.amountCents, 1500)
})

test('settleFareHold: credits billing choice cancels hold when no boost, but settles boost hold when boost present', async () => {
  // Case A: credits billing without boost cancels the hold and returns null
  let canceledId = null
  const stripe = {
    paymentIntents: {
      retrieve: async (id) => ({ id, status: 'requires_capture', amount: 3000 }),
      cancel: async (id) => {
        canceledId = id
        return { id, status: 'canceled' }
      },
      capture: async () => ({ id: 'pi_test', status: 'succeeded' }),
    },
  }
  const tripNoBoost = {
    id: 't_cred_no_boost',
    rider_id: 'rider_retry',
    fare_cents: 3000,
    metadata: {
      billing_choice: 'credits',
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_hold_cred',
        authorizationCents: 3600,
      },
    },
  }
  const sbA = createMemoryDb([tripNoBoost])
  const resA = await settleFareHold({
    sb: sbA,
    stripe,
    trip: tripNoBoost,
    finalFareCents: 3000,
  })
  assert.equal(resA, null)
  assert.equal(canceledId, 'pi_hold_cred')
  assert.equal(sbA._trips[0].metadata.fare_authorization.status, 'canceled')
  assert.equal(sbA._trips[0].metadata.fare_authorization.reason, 'credits')

  // Case B: credits billing WITH boost settles the boost hold instead of canceling
  let capturedAmount = null
  const stripeBoost = {
    paymentIntents: {
      retrieve: async (id) => ({ id, status: 'requires_capture', amount: 1500 }),
      capture: async (id, params) => {
        capturedAmount = params.amount_to_capture
        return { id, status: 'succeeded', amount_received: params.amount_to_capture }
      },
      cancel: async () => { throw new Error('should not cancel boost hold') },
    },
  }
  const tripWithBoost = {
    id: 't_cred_boost',
    rider_id: 'rider_retry',
    fare_cents: 3000,
    boost_cents: 1500,
    metadata: {
      billing_choice: 'credits',
      boost_cents: 1500,
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_hold_boost',
        authorizationCents: 1500,
      },
    },
  }
  const sbB = createMemoryDb([tripWithBoost])
  const resB = await settleFareHold({
    sb: sbB,
    stripe: stripeBoost,
    trip: tripWithBoost,
    finalFareCents: 1500,
  })
  assert.equal(resB.ok, true)
  assert.equal(resB.method, 'card')
  assert.equal(resB.amountCents, 1500)
  assert.equal(capturedAmount, 1500)
  assert.equal(sbB._trips[0].metadata.fare_authorization.status, 'captured')
})

test('settleFareHold: capture failure triggers off-session replacement charge; tests successful replacement and parked balance fallback', async () => {
  // Case A: Capture fails, but replacement off-session charge succeeds
  let cancelCalled = false
  let replacementCreated = null
  const stripeReplaceOk = {
    paymentIntents: {
      retrieve: async (id) => ({ id, status: 'requires_capture', amount: 3000 }),
      capture: async () => {
        const err = new Error('Card expired during ride')
        err.code = 'expired_card'
        throw err
      },
      cancel: async (id) => {
        cancelCalled = true
        return { id, status: 'canceled' }
      },
      create: async (params) => {
        replacementCreated = params
        return { id: 'pi_replacement_ok', status: 'succeeded', amount: params.amount }
      },
    },
    paymentMethods: { list: async () => ({ data: [] }) },
  }
  const tripReplace = {
    id: 't_capture_fail_replace_ok',
    rider_id: 'rider_retry',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_hold_failed',
        authorizationCents: 3000,
        paymentMethodId: 'pm_primary',
      },
    },
  }
  const sbA = createMemoryDb([tripReplace])
  const resA = await settleFareHold({
    sb: sbA,
    stripe: stripeReplaceOk,
    trip: tripReplace,
    finalFareCents: 3000,
  })
  assert.equal(resA.ok, true)
  assert.equal(resA.method, 'card')
  assert.equal(resA.amountCents, 3000)
  assert.equal(resA.paymentIntentId, 'pi_replacement_ok')
  assert.equal(cancelCalled, true)
  assert.equal(replacementCreated.amount, 3000)
  assert.equal(sbA._trips[0].metadata.fare_authorization.status, 'captured')
  assert.equal(sbA._trips[0].metadata.fare_authorization.replaced, true)

  // Case B: Capture fails AND replacement charge also fails -> parks balance
  const stripeReplaceFail = {
    paymentIntents: {
      retrieve: async (id) => ({ id, status: 'requires_capture', amount: 3000 }),
      capture: async () => {
        const err = new Error('Hold expired')
        err.code = 'expired_card'
        throw err
      },
      cancel: async () => ({ status: 'canceled' }),
      create: async () => {
        const err = new Error('Card declined completely')
        err.code = 'card_declined'
        throw err
      },
    },
    paymentMethods: { list: async () => ({ data: [] }) },
  }
  const tripBothFail = {
    id: 't_capture_fail_replace_fail',
    rider_id: 'rider_retry',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_hold_failed_2',
        authorizationCents: 3000,
        paymentMethodId: 'pm_primary',
      },
    },
  }
  const sbB = createMemoryDb([tripBothFail])
  const resB = await settleFareHold({
    sb: sbB,
    stripe: stripeReplaceFail,
    trip: tripBothFail,
    finalFareCents: 3000,
  })
  assert.equal(resB.ok, false)
  assert.equal(resB.parked, true)
  assert.equal(resB.outstanding.amountCents, 3000)
  assert.equal(resB.outstanding.reason, 'capture_failed')
  assert.equal(sbB._trips[0].metadata.outstanding_balance.amountCents, 3000)
  assert.equal(sbB._trips[0].metadata.outstanding_balance.reason, 'capture_failed')
})

test('syncBoostAuthorization: handles reauthorization failure by parking balance and setting failed status', async () => {
  const trip = {
    id: 't_boost_reauth_fail',
    rider_id: 'rider_retry',
    fare_cents: 2000,
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_old_boost_hold',
        authorizationCents: 2400,
        estimatedFareCents: 2000,
        bufferCents: 400,
        boostCents: 0,
        paymentMethodId: 'pm_primary',
      },
    },
  }
  let oldCanceled = false
  const stripe = {
    paymentIntents: {
      cancel: async (id) => {
        oldCanceled = true
        return { id, status: 'canceled' }
      },
      create: async () => {
        const err = new Error('Card declined on boost reauth')
        err.code = 'card_declined'
        throw err
      },
    },
    paymentMethods: { list: async () => ({ data: [] }) },
  }
  const sb = createMemoryDb([trip])
  const res = await syncBoostAuthorization({
    sb,
    stripe,
    trip,
    boostCents: 1500,
  })
  assert.equal(res.ok, false)
  assert.equal(res.method, 'reauth_failed')
  assert.equal(oldCanceled, true)
  assert.equal(res.parked, true)
  assert.equal(res.outstanding.code, 'card_declined')
  assert.equal(sb._trips[0].metadata.fare_authorization.status, 'failed')
  assert.equal(sb._trips[0].metadata.outstanding_balance.code, 'card_declined')
})

test('releaseOpenFareHold: returns hold_release_failed when stripe cancel rejects', async () => {
  const trip = {
    id: 't_release_fail',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_cancel_error',
        authorizationCents: 2500,
      },
    },
  }
  const stripe = {
    paymentIntents: {
      cancel: async () => {
        throw new Error('Stripe network error on cancel')
      },
    },
  }
  const sb = createMemoryDb([trip])
  const res = await releaseOpenFareHold({
    sb,
    stripe,
    trip,
    reason: 'rider_cancel',
  })
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'hold_release_failed')
  assert.equal(res.paymentIntentId, 'pi_cancel_error')
  assert.equal(sb._trips[0].metadata.fare_authorization.status, 'requires_capture')
})

test('settleSwitchHold: deep coverage for cancel failure, create failure, status mismatch cancellation, and prior intent cleanup', async () => {
  const trip = {
    id: 't_switch_errors',
    fare_cents: 2500,
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_switch_prior',
        authorizationCents: 3000,
      },
    },
  }

  // 1. hold = 'release' and stripe.paymentIntents.cancel fails
  const stripeCancelFail = {
    paymentIntents: {
      cancel: async () => { throw new Error('Stripe cancel error') },
    },
  }
  const sb1 = createMemoryDb([trip])
  const resCancelFail = await settleSwitchHold({
    stripe: stripeCancelFail,
    sb: sb1,
    trip,
    quote: { hold: 'release' },
    riderId: 'rider_retry',
  })
  assert.equal(resCancelFail.ok, false)
  assert.equal(resCancelFail.code, 'hold_release_failed')
  assert.match(resCancelFail.error, /Could not release the card hold/)

  // 2. hold = 'place' and stripe.paymentIntents.create throws
  const stripeCreateFail = {
    paymentIntents: {
      create: async () => { throw new Error('Card declined on switch') },
    },
  }
  const sb2 = createMemoryDb([trip])
  const resCreateFail = await settleSwitchHold({
    stripe: stripeCreateFail,
    sb: sb2,
    trip,
    quote: { hold: 'place' },
    riderId: 'rider_retry',
    customerId: 'cus_retry',
    paymentMethodId: 'pm_primary',
    fareCents: 2500,
  })
  assert.equal(resCreateFail.ok, false)
  assert.equal(resCreateFail.code, 'hold_replace_failed')
  assert.match(resCreateFail.error, /Could not update the card hold/)

  // 3. hold = 'place' returns status other than requires_capture or succeeded (e.g. requires_action)
  let createdCanceled = false
  const stripeRequiresAction = {
    paymentIntents: {
      create: async () => ({ id: 'pi_needs_3ds', status: 'requires_action' }),
      cancel: async (id) => {
        if (id === 'pi_needs_3ds') createdCanceled = true
        return { id, status: 'canceled' }
      },
    },
  }
  const sb3 = createMemoryDb([trip])
  const res3ds = await settleSwitchHold({
    stripe: stripeRequiresAction,
    sb: sb3,
    trip,
    quote: { hold: 'place' },
    riderId: 'rider_retry',
    customerId: 'cus_retry',
    paymentMethodId: 'pm_primary',
    fareCents: 2500,
  })
  assert.equal(res3ds.ok, false)
  assert.equal(res3ds.code, 'hold_replace_failed')
  assert.equal(createdCanceled, true)

  // 4. hold = 'place' succeeds: cleans up prior intent and marks previous payment row canceled
  let priorCanceled = false
  const stripeSuccess = {
    paymentIntents: {
      create: async (params) => ({ id: 'pi_new_switch_hold', status: 'requires_capture', amount: params.amount }),
      cancel: async (id) => {
        if (id === 'pi_switch_prior') priorCanceled = true
        return { id, status: 'canceled' }
      },
    },
  }
  const sb4 = createMemoryDb([trip])
  sb4._payments.push({
    trip_id: 't_switch_errors',
    stripe_payment_intent_id: 'pi_switch_prior',
    status: 'pending',
  })
  const resSuccess = await settleSwitchHold({
    stripe: stripeSuccess,
    sb: sb4,
    trip,
    quote: { hold: 'place' },
    riderId: 'rider_retry',
    customerId: 'cus_retry',
    paymentMethodId: 'pm_primary',
    fareCents: 2500,
  })
  assert.equal(resSuccess.ok, true)
  assert.equal(priorCanceled, true)
  assert.equal(resSuccess.patch.fare_authorization.paymentIntentId, 'pi_new_switch_hold')
  assert.equal(resSuccess.patch.fare_authorization.replacedPaymentIntentId, 'pi_switch_prior')
  assert.equal(sb4._payments[0].status, 'canceled')
})

test('settleFareHold: chargeOverage zero-amount guard handles zero or negative replacement fare safely', async () => {
  // When capture fails on a trip with zero or negative final fare (e.g. waived or refunded in flight),
  // replacement charge does not create a 0-cent or negative Stripe charge.
  let createCalled = false
  const stripe = {
    paymentIntents: {
      retrieve: async (id) => ({ id, status: 'requires_capture', amount: 2000 }),
      capture: async () => {
        const err = new Error('Hold expired')
        err.code = 'expired_card'
        throw err
      },
      cancel: async () => ({ status: 'canceled' }),
      create: async () => {
        createCalled = true
        return { id: 'pi_unexpected', status: 'succeeded' }
      },
    },
    paymentMethods: { list: async () => ({ data: [] }) },
  }

  const trip = {
    id: 't_zero_replace',
    rider_id: 'rider_retry',
    fare_cents: 2000,
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_hold_zero_replace',
        authorizationCents: 2400,
        paymentMethodId: 'pm_primary',
      },
    },
  }

  const sb = createMemoryDb([trip])
  // When finalFareCents is 0, settleFareHold takes the plan.action = 'cancel' / 'zero_due' path directly
  const resZero = await settleFareHold({
    sb,
    stripe,
    trip,
    finalFareCents: 0,
  })
  assert.equal(resZero.ok, true)
  assert.equal(resZero.method, 'none')
  assert.equal(resZero.reason, 'zero_due')
  assert.equal(resZero.amountCents, 0)
  assert.equal(createCalled, false)
})

test('syncBoostAuthorization: hold_already_covers when new boost does not increase authorized amount', async () => {
  // 1. Regular card trip: existing hold covers new boost
  const tripCard = {
    id: 't_boost_already_covers_card',
    fare_cents: 2500,
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_card_hold_cov',
        authorizationCents: 3500, // covers estimate 2500 + buffer 500 + boost 500 = 3500
        estimatedFareCents: 2500,
      },
    },
  }
  let stripeCalled = false
  const stripe = {
    paymentIntents: {
      incrementAuthorization: async () => {
        stripeCalled = true
        return { status: 'requires_capture' }
      },
      create: async () => {
        stripeCalled = true
        return { status: 'requires_capture' }
      },
    },
  }
  const sbCard = createMemoryDb([tripCard])
  const resCard = await syncBoostAuthorization({
    sb: sbCard,
    stripe,
    trip: tripCard,
    boostCents: 400, // 2500 + 500 buffer + 400 boost = 3400 <= 3500
  })
  assert.equal(resCard.ok, true)
  assert.equal(resCard.skipped, true)
  assert.equal(resCard.reason, 'hold_already_covers')
  assert.equal(resCard.authorizationCents, 3400)
  assert.equal(stripeCalled, false)

  // 2. Credits trip: base is 0, hold already covers if new boost is <= existing auth
  const tripCredits = {
    id: 't_boost_already_covers_credits',
    fare_cents: 3000,
    metadata: {
      billing_choice: 'credits',
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_cred_hold_cov',
        authorizationCents: 1500,
        estimatedFareCents: 0,
      },
    },
  }
  const sbCred = createMemoryDb([tripCredits])
  const resCred = await syncBoostAuthorization({
    sb: sbCred,
    stripe,
    trip: tripCredits,
    boostCents: 1000, // 1000 <= 1500
  })
  assert.equal(resCred.ok, true)
  assert.equal(resCred.skipped, true)
  assert.equal(resCred.reason, 'hold_already_covers')
  assert.equal(resCred.authorizationCents, 1000)
  assert.equal(resCred.boostCents, 1000)
  assert.equal(stripeCalled, false)

  // 3. Robustness: auth.authorizationCents is string or non-finite
  const tripStringAuth = {
    id: 't_boost_string_auth',
    fare_cents: 2000,
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_str_hold',
        authorizationCents: '3000',
        estimatedFareCents: 2000,
      },
    },
  }
  const resString = await syncBoostAuthorization({
    sb: createMemoryDb([tripStringAuth]),
    stripe,
    trip: tripStringAuth,
    boostCents: 200, // 2000 + 400 + 200 = 2600 <= 3000
  })
  assert.equal(resString.ok, true)
  assert.equal(resString.skipped, true)
  assert.equal(resString.reason, 'hold_already_covers')
})

test('authorizeRideRequest: covers backup bonus on credits trips and distinguishes credits-only vs backup-bonus trips', async () => {
  let createdIntent = null
  const stripe = {
    paymentIntents: {
      create: async (params) => {
        createdIntent = params
        return {
          id: 'pi_backup_credits_hold',
          status: 'requires_capture',
          amount: params.amount,
        }
      },
    },
    paymentMethods: { list: async () => ({ data: [] }) },
  }

  // 1. Credits trip with backup queue enabled and bonusCents: holds backup fee + buffer + boost
  const tripWithBackup = {
    id: 't_credits_with_backup',
    rider_id: 'rider_retry',
    fare_cents: 4500,
    metadata: {
      billing_choice: 'credits',
      backup_queue: {
        enabled: true,
        bonusCents: 1000,
      },
      boost_cents: 500,
    },
  }
  const sbWithBackup = createMemoryDb([tripWithBackup])
  const resBackup = await authorizeRideRequest({
    sb: sbWithBackup,
    stripe,
    trip: tripWithBackup,
    riderId: 'rider_retry',
  })
  assert.equal(resBackup.ok, true)
  assert.equal(resBackup.skipped, undefined)
  // Base on backupBonusCents (1000): buffer is max(200, 1000*0.2) = 200. Base auth = 1200. Boost = 500. Total = 1700.
  assert.equal(resBackup.authorization.authorizationCents, 1700)
  assert.equal(resBackup.authorization.estimatedFareCents, 1000)
  assert.equal(resBackup.authorization.bufferCents, 200)
  assert.equal(resBackup.authorization.boostCents, 500)
  assert.equal(createdIntent.amount, 1700)
  assert.equal(createdIntent.metadata.estimatedFareCents, '1000')
  assert.equal(createdIntent.metadata.boostCents, '500')

  const savedTrip = sbWithBackup._trips[0]
  assert.equal(savedTrip.metadata.fare_authorization.authorizationCents, 1700)
  assert.equal(savedTrip.metadata.fare_authorization.status, 'requires_capture')

  // 2. Credits trip with backup queue enabled but bonusCents is 0 and boost is 0: skips hold
  const tripNoBonus = {
    id: 't_credits_no_bonus',
    rider_id: 'rider_retry',
    fare_cents: 4500,
    metadata: {
      billing_choice: 'credits',
      backup_queue: {
        enabled: true,
        bonusCents: 0,
      },
      boost_cents: 0,
    },
  }
  const sbNoBonus = createMemoryDb([tripNoBonus])
  const resNoBonus = await authorizeRideRequest({
    sb: sbNoBonus,
    stripe,
    trip: tripNoBonus,
    riderId: 'rider_retry',
  })
  assert.equal(resNoBonus.ok, true)
  assert.equal(resNoBonus.skipped, true)
  assert.equal(resNoBonus.reason, 'credits')

  // 3. Trip without Stripe configured skips hold gracefully with reason stripe_not_configured
  const tripUnconf = {
    id: 't_unconf_stripe',
    rider_id: 'rider_retry',
    fare_cents: 3000,
  }
  const resUnconf = await authorizeRideRequest({
    sb: createMemoryDb([tripUnconf]),
    stripe: null,
    trip: tripUnconf,
  })
  assert.equal(resUnconf.ok, true)
  assert.equal(resUnconf.skipped, true)
  assert.equal(resUnconf.reason, 'stripe_not_configured')
})



