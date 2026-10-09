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

