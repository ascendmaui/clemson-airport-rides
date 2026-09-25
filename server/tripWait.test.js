import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import Stripe from 'stripe'

// Set STRIPE_SECRET_KEY before importing tripWait.js so friendRideLib initializes stripeOk() as true.
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_trip_wait_key'

const { assertAction, chargeWaitFees, applyTripWait } = await import('./tripWait.js')

// ---------------------------------------------------------------------------
// Stripe mock harness
// ---------------------------------------------------------------------------
const dummyStripe = new Stripe('sk_test_mock_trip_wait_key')
const piProto = Object.getPrototypeOf(dummyStripe.paymentIntents)
const origCreate = piProto.create
const origRetrieve = piProto.retrieve
const origUpdate = piProto.update

let stripeHandlers = {}

piProto.create = async function (params, options) {
  if (stripeHandlers.create) return stripeHandlers.create(params, options)
  return { id: 'pi_default_success', status: 'succeeded', amount: params.amount }
}

piProto.retrieve = async function (id) {
  if (stripeHandlers.retrieve) return stripeHandlers.retrieve(id)
  return { id, status: 'succeeded', amount: 500 }
}

piProto.update = async function (id, params) {
  if (stripeHandlers.update) return stripeHandlers.update(id, params)
  return { id, status: 'requires_action', ...params }
}

test.beforeEach(() => {
  stripeHandlers = {}
})

test.after(() => {
  piProto.create = origCreate
  piProto.retrieve = origRetrieve
  piProto.update = origUpdate
})

// ---------------------------------------------------------------------------
// Supabase in-memory mock harness
// ---------------------------------------------------------------------------
function createMockSb({
  profiles = [],
  payments = [],
  rpc = null,
  errors = {},
} = {}) {
  const profileList = profiles.map((p) => ({ ...p }))
  const paymentList = payments.map((p) => ({ ...p }))

  return {
    _profiles: profileList,
    _payments: paymentList,
    rpc: async (fn, args) => {
      if (errors.rpc) return { data: null, error: errors.rpc }
      if (rpc) return rpc(fn, args)
      return { data: null, error: null }
    },
    from(table) {
      let op = 'select'
      let updatePayload = null
      let insertPayload = null
      const filters = []
      let orderCol = null
      let orderAsc = true
      let limitCount = null

      const builder = {
        select() {
          return builder
        },
        insert(row) {
          op = 'insert'
          insertPayload = row
          return builder
        },
        update(patch) {
          op = 'update'
          updatePayload = patch
          return builder
        },
        eq(col, val) {
          filters.push((row) => row[col] === val)
          return builder
        },
        in(col, vals) {
          filters.push((row) => vals.includes(row[col]))
          return builder
        },
        order(col, opts = {}) {
          orderCol = col
          orderAsc = opts.ascending !== false
          return builder
        },
        limit(n) {
          limitCount = n
          return builder
        },
        async execute() {
          if (errors[table]) {
            return { data: null, error: errors[table] }
          }
          if (table === 'profiles') {
            if (errors.profiles) return { data: null, error: errors.profiles }
            const rows = profileList.filter((r) => filters.every((f) => f(r)))
            return { data: rows, error: null }
          }
          if (table === 'payments') {
            if (op === 'insert') {
              if (errors.paymentsInsert) return { data: null, error: errors.paymentsInsert }
              const id = `pay_${paymentList.length + 1}`
              const created = { id, created_at: new Date().toISOString(), ...insertPayload }
              paymentList.push(created)
              return { data: created, error: null }
            }
            if (op === 'update') {
              if (errors.paymentsUpdate) return { data: null, error: errors.paymentsUpdate }
              const rows = paymentList.filter((r) => filters.every((f) => f(r)))
              for (const r of rows) {
                Object.assign(r, updatePayload)
              }
              return { data: rows, error: null }
            }
            if (errors.paymentsSelect) return { data: null, error: errors.paymentsSelect }
            let rows = paymentList.filter((r) => filters.every((f) => f(r)))
            if (orderCol) {
              rows = [...rows].sort((a, b) => {
                if (a[orderCol] === b[orderCol]) return 0
                return (a[orderCol] > b[orderCol] ? 1 : -1) * (orderAsc ? 1 : -1)
              })
            }
            if (limitCount != null) {
              rows = rows.slice(0, limitCount)
            }
            return { data: rows, error: null }
          }
          return { data: null, error: { message: `Table ${table} not found` } }
        },
        async single() {
          const res = await builder.execute()
          if (res.error) return res
          return { data: Array.isArray(res.data) ? res.data[0] || null : res.data, error: null }
        },
        async maybeSingle() {
          const res = await builder.execute()
          if (res.error) return res
          return { data: Array.isArray(res.data) ? res.data[0] || null : res.data, error: null }
        },
        then(onFulfilled, onRejected) {
          return builder.execute().then(onFulfilled, onRejected)
        },
      }
      return builder
    },
  }
}

// ===========================================================================
// 1. assertAction(action, tripId)
// ===========================================================================

test('assertAction allows valid actions and valid tripId strings', () => {
  const validActions = ['arrive', 'tick', 'cancel', 'start', 'complete']
  for (const action of validActions) {
    assert.doesNotThrow(() => assertAction(action, 'trip_abc_123'))
  }
})

test('assertAction rejects unknown actions with 400', () => {
  const invalidActions = ['unknown', 'ARRIVE', 'stop', 'pause', '', null, undefined, 123, {}]
  for (const action of invalidActions) {
    assert.throws(
      () => assertAction(action, 'trip_123'),
      (err) => {
        assert.equal(err.status, 400)
        assert.equal(err.message, 'Unknown wait action')
        return true
      },
    )
  }
})

test('assertAction rejects invalid tripId with 400', () => {
  const invalidTripIds = ['', '   ', null, undefined, 12345, {}, [], true]
  for (const tripId of invalidTripIds) {
    assert.throws(
      () => assertAction('arrive', tripId),
      (err) => {
        assert.equal(err.status, 400)
        assert.equal(err.message, 'tripId required')
        return true
      },
    )
  }
})

// ===========================================================================
// 2. chargeWaitFees(sb, trip) - Skips & Pre-checks
// ===========================================================================

test('chargeWaitFees skips non-billable trip status (arrived, in_progress, accepted, scheduled)', async () => {
  const sb = createMockSb()
  for (const status of ['arrived', 'in_progress', 'accepted', 'scheduled']) {
    const res = await chargeWaitFees(sb, {
      id: 'trip_1',
      status,
      wait_fee_cents: 200,
      cancel_fee_cents: 100,
    })
    assert.deepEqual(res, { status: 'skipped', reason: 'nothing_to_charge', amountCents: 0 })
  }
  assert.equal(sb._payments.length, 0)
})

test('chargeWaitFees skips completed trip when wait_fee_cents is 0 or null', async () => {
  const sb = createMockSb()
  const resZero = await chargeWaitFees(sb, { id: 'trip_1', status: 'completed', wait_fee_cents: 0 })
  assert.deepEqual(resZero, { status: 'skipped', reason: 'nothing_to_charge', amountCents: 0 })

  const resNull = await chargeWaitFees(sb, { id: 'trip_1', status: 'completed', wait_fee_cents: null })
  assert.deepEqual(resNull, { status: 'skipped', reason: 'nothing_to_charge', amountCents: 0 })
})

test('chargeWaitFees ignores cancel_fee_cents on completed trips', async () => {
  const sb = createMockSb()
  // cancel_fee_cents is only billable on cancelled_wait
  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    status: 'completed',
    wait_fee_cents: 0,
    cancel_fee_cents: 500,
  })
  assert.deepEqual(res, { status: 'skipped', reason: 'nothing_to_charge', amountCents: 0 })
})

test('chargeWaitFees skips cancelled_wait trip when total amount is 0', async () => {
  const sb = createMockSb()
  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    status: 'cancelled_wait',
    wait_fee_cents: 0,
    cancel_fee_cents: 0,
  })
  assert.deepEqual(res, { status: 'skipped', reason: 'nothing_to_charge', amountCents: 0 })
})

test('chargeWaitFees handles non-numeric fee values safely', async () => {
  const sb = createMockSb()
  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    status: 'completed',
    wait_fee_cents: 'not-a-number',
  })
  assert.deepEqual(res, { status: 'skipped', reason: 'nothing_to_charge', amountCents: 0 })
})

test('chargeWaitFees safely skips when trip is null, non-object, or missing trip id', async () => {
  const sb = createMockSb()
  for (const badTrip of [null, undefined, 'trip_1', 123, {}, { status: 'completed', wait_fee_cents: 200 }]) {
    const res = await chargeWaitFees(sb, badTrip)
    assert.deepEqual(res, { status: 'skipped', reason: 'nothing_to_charge', amountCents: 0 })
  }
})

test('chargeWaitFees clamps negative fee cents to 0', async () => {
  const sb = createMockSb()
  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    status: 'completed',
    wait_fee_cents: -200,
  })
  assert.deepEqual(res, { status: 'skipped', reason: 'nothing_to_charge', amountCents: 0 })
})

// ===========================================================================
// 3. chargeWaitFees(sb, trip) - Database Query Errors
// ===========================================================================

test('chargeWaitFees throws 500 when loadPayments query fails', async () => {
  const sb = createMockSb({
    errors: { paymentsSelect: { message: 'Database connection failed' } },
  })
  await assert.rejects(
    async () => {
      await chargeWaitFees(sb, {
        id: 'trip_1',
        rider_id: 'rider_1',
        status: 'cancelled_wait',
        wait_fee_cents: 200,
      })
    },
    (err) => {
      assert.equal(err.status, 500)
      assert.equal(err.message, 'Database connection failed')
      return true
    },
  )
})

test('chargeWaitFees throws 500 when profiles lookup query fails', async () => {
  const sb = createMockSb({
    errors: { profiles: { message: 'Profile lookup timeout' } },
  })
  await assert.rejects(
    async () => {
      await chargeWaitFees(sb, {
        id: 'trip_1',
        rider_id: 'rider_1',
        status: 'cancelled_wait',
        wait_fee_cents: 200,
      })
    },
    (err) => {
      assert.equal(err.status, 500)
      assert.equal(err.message, 'Profile lookup timeout')
      return true
    },
  )
})

// ===========================================================================
// 4. chargeWaitFees(sb, trip) - Prior Succeeded Payments
// ===========================================================================

test('chargeWaitFees returns already_paid when prior succeeded payments cover full amount', async () => {
  const sb = createMockSb({
    payments: [
      { id: 'p1', trip_id: 'trip_1', kind: 'wait_fee', status: 'succeeded', amount_cents: 400 },
      { id: 'p2', trip_id: 'trip_1', kind: 'cancel_fee', status: 'succeeded', amount_cents: 100 },
    ],
  })
  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    rider_id: 'rider_1',
    status: 'cancelled_wait',
    wait_fee_cents: 400,
    cancel_fee_cents: 100,
  })
  assert.deepEqual(res, {
    status: 'succeeded',
    reason: 'already_paid',
    amountCents: 500,
  })
})

test('chargeWaitFees ignores non-succeeded prior payments when checking already_paid', async () => {
  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' }],
    payments: [
      { id: 'p1', trip_id: 'trip_1', kind: 'wait_fee', status: 'failed', amount_cents: 200 },
      { id: 'p2', trip_id: 'trip_1', kind: 'wait_fee', status: 'pending', amount_cents: 200 },
    ],
  })
  stripeHandlers.create = async () => ({ id: 'pi_new_1', status: 'succeeded' })

  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    rider_id: 'rider_1',
    status: 'completed',
    wait_fee_cents: 200,
  })
  assert.equal(res.status, 'succeeded')
  assert.equal(res.paymentIntentId, 'pi_new_1')
})

test('// BUG?: partial payments charge full amount instead of (amount - paid)', async () => {
  // BUG?: When paid > 0 but paid < amount, chargeWaitFees creates a PaymentIntent
  // for the entire `amount` (e.g. 500) rather than the unpaid remainder (e.g. 500 - 200 = 300).
  let chargedAmount = null
  stripeHandlers.create = async (params) => {
    chargedAmount = params.amount
    return { id: 'pi_full_amount', status: 'succeeded' }
  }

  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' }],
    payments: [
      { id: 'p1', trip_id: 'trip_1', kind: 'wait_fee', status: 'succeeded', amount_cents: 200 },
    ],
  })

  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    rider_id: 'rider_1',
    status: 'cancelled_wait',
    wait_fee_cents: 400,
    cancel_fee_cents: 100, // total amount is 500, but 200 was already paid
  })

  assert.equal(res.status, 'succeeded')
  // Documents current behavior: it charged 500 instead of 300
  assert.equal(chargedAmount, 500)
})

// ===========================================================================
// 5. chargeWaitFees(sb, trip) - Unconfigured Stripe & Missing Payment Method
// ===========================================================================

test('chargeWaitFees marks payments as pending with stripe_unconfigured when Stripe is unconfigured', () => {
  // In an isolated sub-process with empty STRIPE_SECRET_KEY, stripeOk() returns false
  const script = `
    delete process.env.STRIPE_SECRET_KEY;
    const { chargeWaitFees } = await import('./server/tripWait.js');
    const payments = [];
    const mockSb = {
      _payments: payments,
      from: (table) => {
        const q = {
          select: () => q,
          eq: () => q,
          in: () => Promise.resolve({ data: [] }),
          maybeSingle: () => Promise.resolve({ data: { id: 'r1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' } }),
          order: () => q,
          limit: () => Promise.resolve({ data: [] }),
          insert: (row) => {
            payments.push(row);
            return { select: () => ({ single: () => Promise.resolve({ data: { id: 'p_1' }, error: null }) }) };
          }
        };
        return q;
      }
    };
    const trip = { id: 't_unconf', rider_id: 'r1', status: 'cancelled_wait', wait_fee_cents: 300, cancel_fee_cents: 100 };
    const res = await chargeWaitFees(mockSb, trip);
    console.log(JSON.stringify({ res, payments }));
  `
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
  })
  const { res, payments } = JSON.parse(out.toString())

  assert.equal(res.status, 'pending')
  assert.equal(res.reason, 'stripe_unconfigured')
  assert.equal(res.amountCents, 400)
  assert.equal(res.waitFeeCents, 300)
  assert.equal(res.cancelFeeCents, 100)

  assert.equal(payments.length, 2)
  assert.equal(payments[0].kind, 'wait_fee')
  assert.equal(payments[0].status, 'pending')
  assert.equal(payments[0].stripe_payment_intent_id, null)
  assert.equal(payments[1].kind, 'cancel_fee')
  assert.equal(payments[1].status, 'pending')
  assert.equal(payments[1].stripe_payment_intent_id, null)
})

test('chargeWaitFees returns no_card when rider profile is null', async () => {
  const sb = createMockSb({
    profiles: [], // no profile returned
  })
  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    rider_id: 'non_existent_rider',
    status: 'cancelled_wait',
    wait_fee_cents: 200,
    cancel_fee_cents: 100,
  })

  assert.equal(res.status, 'pending')
  assert.equal(res.reason, 'no_card')
  assert.equal(res.amountCents, 300)

  assert.equal(sb._payments.length, 2)
  assert.equal(sb._payments[0].status, 'pending')
  assert.equal(sb._payments[0].stripe_payment_intent_id, null)
  assert.equal(sb._payments[1].status, 'pending')
})

test('chargeWaitFees returns no_card when profile is missing stripe_default_pm_id', async () => {
  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: null }],
  })
  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    rider_id: 'rider_1',
    status: 'completed',
    wait_fee_cents: 200,
  })

  assert.equal(res.status, 'pending')
  assert.equal(res.reason, 'no_card')
  assert.equal(res.amountCents, 200)
  assert.equal(sb._payments[0].kind, 'wait_fee')
  assert.equal(sb._payments[0].status, 'pending')
})

test('// BUG?: canCharge requires profile.stripe_customer_id making ensureStripeCustomer dead code', async () => {
  // BUG?: If profile has a payment method but stripe_customer_id is missing,
  // canCharge evaluates to false. It never calls ensureStripeCustomer to create a customer.
  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: null, stripe_default_pm_id: 'pm_card_valid' }],
  })
  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    rider_id: 'rider_1',
    status: 'completed',
    wait_fee_cents: 100,
  })

  // Documents current behavior: returns no_card instead of lazily creating customer
  assert.equal(res.status, 'pending')
  assert.equal(res.reason, 'no_card')
})

// ===========================================================================
// 6. chargeWaitFees(sb, trip) - Idempotency & In-Flight Intent Reuse
// ===========================================================================

test('chargeWaitFees reuses in-flight intent that has already succeeded in Stripe', async () => {
  stripeHandlers.retrieve = async (id) => {
    assert.equal(id, 'pi_inflight_123')
    return { id, status: 'succeeded', amount: 500 }
  }

  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' }],
    payments: [
      {
        id: 'p_inflight',
        trip_id: 'trip_1',
        kind: 'wait_fee',
        status: 'pending',
        amount_cents: 400,
        stripe_payment_intent_id: 'pi_inflight_123',
      },
    ],
  })

  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    rider_id: 'rider_1',
    status: 'cancelled_wait',
    wait_fee_cents: 400,
    cancel_fee_cents: 100,
    platform_fee_cents: 100,
  })

  assert.equal(res.status, 'succeeded')
  assert.equal(res.paymentIntentId, 'pi_inflight_123')
  assert.equal(res.platformFeeCents, 100)

  // Verify DB payments were updated to succeeded
  const waitRow = sb._payments.find((p) => p.kind === 'wait_fee')
  assert.equal(waitRow.status, 'succeeded')
  assert.equal(waitRow.stripe_payment_intent_id, 'pi_inflight_123')
})

test('chargeWaitFees reuses in-flight intent that is still open/pending in Stripe', async () => {
  stripeHandlers.retrieve = async (id) => {
    return { id, status: 'requires_action', amount: 300 }
  }

  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' }],
    payments: [
      {
        id: 'p_open',
        trip_id: 'trip_1',
        kind: 'wait_fee',
        status: 'pending',
        amount_cents: 300,
        stripe_payment_intent_id: 'pi_open_456',
      },
    ],
  })

  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    rider_id: 'rider_1',
    status: 'completed',
    wait_fee_cents: 300,
  })

  assert.equal(res.status, 'pending')
  assert.equal(res.paymentIntentId, 'pi_open_456')
})

test('chargeWaitFees creates new attempt when in-flight intent was canceled in Stripe', async () => {
  let createdAttemptKey = null
  stripeHandlers.retrieve = async (id) => {
    return { id, status: 'canceled', amount: 300 }
  }
  stripeHandlers.create = async (params, opts) => {
    createdAttemptKey = opts.idempotencyKey
    return { id: 'pi_brand_new', status: 'succeeded' }
  }

  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' }],
    payments: [
      {
        id: 'p_canceled',
        trip_id: 'trip_1',
        kind: 'wait_fee',
        status: 'failed',
        amount_cents: 300,
        stripe_payment_intent_id: 'pi_canceled_789',
      },
    ],
  })

  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    rider_id: 'rider_1',
    status: 'completed',
    wait_fee_cents: 300,
  })

  assert.equal(res.status, 'succeeded')
  assert.equal(res.paymentIntentId, 'pi_brand_new')
  assert.equal(createdAttemptKey, 'wait:trip_1:rider_1:charge:attempt:pi_canceled_789')
})

// ===========================================================================
// 7. chargeWaitFees(sb, trip) - Successful Stripe Charges
// ===========================================================================

test('chargeWaitFees successfully charges auto-cancelled wait + cancel package ($4 + $1 = $5)', async () => {
  let createParams = null
  let createOpts = null
  stripeHandlers.create = async (params, opts) => {
    createParams = params
    createOpts = opts
    return { id: 'pi_autocancel_success', status: 'succeeded' }
  }

  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_card_1' }],
  })

  const trip = {
    id: 'trip_100',
    rider_id: 'rider_1',
    status: 'cancelled_wait',
    wait_fee_cents: 400,
    cancel_fee_cents: 100,
    platform_fee_cents: 100,
    wait_cancel_reason: 'auto',
  }

  const res = await chargeWaitFees(sb, trip)

  assert.deepEqual(res, {
    status: 'succeeded',
    paymentIntentId: 'pi_autocancel_success',
    amountCents: 500,
    waitFeeCents: 400,
    cancelFeeCents: 100,
    platformFeeCents: 100,
  })

  assert.equal(createOpts.idempotencyKey, 'wait:trip_100:rider_1:charge')
  assert.equal(createParams.amount, 500)
  assert.equal(createParams.customer, 'cus_1')
  assert.equal(createParams.payment_method, 'pm_card_1')
  assert.equal(createParams.off_session, true)
  assert.equal(createParams.confirm, true)
  assert.equal(createParams.description, 'Clemson RIDES wait time + cancellation')
  assert.deepEqual(createParams.metadata, {
    tripId: 'trip_100',
    riderId: 'rider_1',
    kind: 'wait_cancel',
    waitFeeCents: '400',
    cancelFeeCents: '100',
    platformFeeCents: '100',
    reason: 'auto',
  })

  // Verify payments rows in database
  const waitRow = sb._payments.find((p) => p.kind === 'wait_fee')
  assert.equal(waitRow.amount_cents, 400)
  assert.equal(waitRow.status, 'succeeded')
  assert.equal(waitRow.stripe_payment_intent_id, 'pi_autocancel_success')

  const cancelRow = sb._payments.find((p) => p.kind === 'cancel_fee')
  assert.equal(cancelRow.amount_cents, 100)
  assert.equal(cancelRow.status, 'succeeded')
  assert.equal(cancelRow.stripe_payment_intent_id, 'pi_autocancel_success')
})

test('chargeWaitFees charges completed trip wait fee only (no cancel fee row)', async () => {
  let createParams = null
  stripeHandlers.create = async (params) => {
    createParams = params
    return { id: 'pi_completed_wait', status: 'succeeded' }
  }

  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_card_1' }],
  })

  const trip = {
    id: 'trip_200',
    rider_id: 'rider_1',
    status: 'completed',
    wait_fee_cents: 200,
    cancel_fee_cents: 0,
    platform_fee_cents: 40,
  }

  const res = await chargeWaitFees(sb, trip)

  assert.equal(res.status, 'succeeded')
  assert.equal(res.amountCents, 200)
  assert.equal(res.cancelFeeCents, 0)
  assert.equal(createParams.description, 'Clemson RIDES wait time')
  assert.equal(createParams.metadata.kind, 'wait_fee')
  assert.equal(createParams.metadata.reason, 'complete')

  // Only wait_fee row is inserted, no cancel_fee row
  assert.equal(sb._payments.length, 1)
  assert.equal(sb._payments[0].kind, 'wait_fee')
  assert.equal(sb._payments[0].amount_cents, 200)
})

test('chargeWaitFees handles Stripe off-session charge returning requires_action as pending', async () => {
  stripeHandlers.create = async () => ({ id: 'pi_action_req', status: 'requires_action' })

  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' }],
  })

  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    rider_id: 'rider_1',
    status: 'completed',
    wait_fee_cents: 100,
  })

  assert.equal(res.status, 'pending')
  assert.equal(res.paymentIntentId, 'pi_action_req')
  assert.equal(sb._payments[0].status, 'pending')
  assert.equal(sb._payments[0].stripe_payment_intent_id, 'pi_action_req')
})

// ===========================================================================
// 8. chargeWaitFees(sb, trip) - Card Decline & Stripe Errors
// ===========================================================================

test('chargeWaitFees handles card decline error with payment_intent id attached', async () => {
  stripeHandlers.create = async () => {
    const err = new Error('Your card has insufficient funds.')
    err.payment_intent = { id: 'pi_declined_123' }
    throw err
  }

  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' }],
  })

  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    rider_id: 'rider_1',
    status: 'cancelled_wait',
    wait_fee_cents: 200,
    cancel_fee_cents: 100,
  })

  assert.equal(res.status, 'failed')
  assert.equal(res.error, 'Your card has insufficient funds.')
  assert.equal(res.amountCents, 300)

  // Payments stored as failed with stripe_payment_intent_id
  assert.equal(sb._payments.length, 2)
  assert.equal(sb._payments[0].status, 'failed')
  assert.equal(sb._payments[0].stripe_payment_intent_id, 'pi_declined_123')
  assert.equal(sb._payments[1].status, 'failed')
  assert.equal(sb._payments[1].stripe_payment_intent_id, 'pi_declined_123')
})

test('chargeWaitFees handles Stripe network error without payment_intent attached', async () => {
  stripeHandlers.create = async () => {
    throw new Error('Stripe API unreachable')
  }

  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' }],
  })

  const res = await chargeWaitFees(sb, {
    id: 'trip_1',
    rider_id: 'rider_1',
    status: 'completed',
    wait_fee_cents: 200,
  })

  assert.equal(res.status, 'failed')
  assert.equal(res.error, 'Stripe API unreachable')
  assert.equal(sb._payments[0].status, 'failed')
  assert.equal(sb._payments[0].stripe_payment_intent_id, null)
})

// ===========================================================================
// 9. chargeWaitFees(sb, trip) - upsertPayment Behavior
// ===========================================================================

test('chargeWaitFees upsert updates an existing pending payment row', async () => {
  stripeHandlers.create = async () => ({ id: 'pi_updated_intent', status: 'succeeded' })

  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' }],
    payments: [
      {
        id: 'existing_pay_1',
        trip_id: 'trip_1',
        rider_id: 'rider_1',
        kind: 'wait_fee',
        amount_cents: 100,
        status: 'pending',
        stripe_payment_intent_id: null,
      },
    ],
  })

  await chargeWaitFees(sb, {
    id: 'trip_1',
    rider_id: 'rider_1',
    status: 'completed',
    wait_fee_cents: 200,
  })

  assert.equal(sb._payments.length, 1)
  assert.equal(sb._payments[0].id, 'existing_pay_1')
  assert.equal(sb._payments[0].amount_cents, 200)
  assert.equal(sb._payments[0].status, 'succeeded')
  assert.equal(sb._payments[0].stripe_payment_intent_id, 'pi_updated_intent')
})

test('chargeWaitFees upsert does not overwrite an existing succeeded payment row', async () => {
  stripeHandlers.create = async () => ({ id: 'pi_new', status: 'succeeded' })

  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' }],
    payments: [
      {
        id: 'succeeded_pay_1',
        trip_id: 'trip_1',
        rider_id: 'rider_1',
        kind: 'wait_fee',
        amount_cents: 200,
        status: 'succeeded',
        stripe_payment_intent_id: 'pi_original',
      },
    ],
  })

  // cancelled_wait with wait $2 and cancel $1 (total $3, so paid $2 < $3)
  await chargeWaitFees(sb, {
    id: 'trip_1',
    rider_id: 'rider_1',
    status: 'cancelled_wait',
    wait_fee_cents: 200,
    cancel_fee_cents: 100,
  })

  const waitRow = sb._payments.find((p) => p.id === 'succeeded_pay_1')
  assert.equal(waitRow.status, 'succeeded')
  assert.equal(waitRow.stripe_payment_intent_id, 'pi_original')
})

test('// BUG?: if Stripe charge succeeds but upsertPayment throws, catch block crashes with 500 leaving charge untracked', async () => {
  // BUG?: If stripe.paymentIntents.create succeeds, but the subsequent Supabase update/insert
  // fails, the catch block catches the DB error, attempts another upsertPayment (which also fails),
  // and throws an unhandled 500, leaving the successful Stripe charge untracked in the DB.
  stripeHandlers.create = async () => ({ id: 'pi_card_charged_ok', status: 'succeeded' })

  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' }],
    errors: { paymentsInsert: { message: 'Database disk full' } },
  })

  await assert.rejects(
    async () => {
      await chargeWaitFees(sb, {
        id: 'trip_1',
        rider_id: 'rider_1',
        status: 'completed',
        wait_fee_cents: 200,
      })
    },
    (err) => {
      assert.equal(err.status, 500)
      assert.match(err.message, /Database disk full/)
      return true
    },
  )
})

// ===========================================================================
// 10. applyTripWait(sb, { action, tripId, actorId }) - Validation & Errors
// ===========================================================================

test('applyTripWait validates action and tripId (delegates to assertAction)', async () => {
  const sb = createMockSb()
  await assert.rejects(
    async () => applyTripWait(sb, { action: 'invalid_action', tripId: 'trip_1', actorId: 'actor_1' }),
    (err) => {
      assert.equal(err.status, 400)
      assert.equal(err.message, 'Unknown wait action')
      return true
    },
  )

  await assert.rejects(
    async () => applyTripWait(sb, { action: 'arrive', tripId: '', actorId: 'actor_1' }),
    (err) => {
      assert.equal(err.status, 400)
      assert.equal(err.message, 'tripId required')
      return true
    },
  )
})

test('applyTripWait throws 401 when actorId is missing', async () => {
  const sb = createMockSb()
  for (const emptyActor of ['', '   ', null, undefined]) {
    await assert.rejects(
      async () => applyTripWait(sb, { action: 'arrive', tripId: 'trip_1', actorId: emptyActor }),
      (err) => {
        assert.equal(err.status, 401)
        assert.equal(err.message, 'Sign in required')
        return true
      },
    )
  }
})

test('applyTripWait maps RPC error trip_not_found to 404', async () => {
  const sb = createMockSb({
    errors: { rpc: { message: 'Error: trip_not_found' } },
  })
  await assert.rejects(
    async () => applyTripWait(sb, { action: 'arrive', tripId: 'trip_1', actorId: 'actor_1' }),
    (err) => {
      assert.equal(err.status, 404)
      assert.equal(err.message, 'Trip not found')
      return true
    },
  )
})

test('applyTripWait maps RPC error forbidden to 403', async () => {
  const sb = createMockSb({
    errors: { rpc: { message: 'raise exception forbidden' } },
  })
  await assert.rejects(
    async () => applyTripWait(sb, { action: 'cancel', tripId: 'trip_1', actorId: 'actor_1' }),
    (err) => {
      assert.equal(err.status, 403)
      assert.equal(err.message, 'Not allowed on this trip')
      return true
    },
  )
})

test('applyTripWait maps RPC error wait_cancel_too_early to 409', async () => {
  const sb = createMockSb({
    errors: { rpc: { message: 'wait_cancel_too_early' } },
  })
  await assert.rejects(
    async () => applyTripWait(sb, { action: 'cancel', tripId: 'trip_1', actorId: 'actor_1' }),
    (err) => {
      assert.equal(err.status, 409)
      assert.equal(err.message, 'Cancel ride opens after 5 minutes of waiting')
      return true
    },
  )
})

test('applyTripWait maps RPC error invalid_status to 409', async () => {
  const sb = createMockSb({
    errors: { rpc: { message: 'invalid_status' } },
  })
  await assert.rejects(
    async () => applyTripWait(sb, { action: 'arrive', tripId: 'trip_1', actorId: 'actor_1' }),
    (err) => {
      assert.equal(err.status, 409)
      assert.equal(err.message, 'Trip is not in a waiting state')
      return true
    },
  )
})

test('applyTripWait maps RPC error bad_action to 400', async () => {
  const sb = createMockSb({
    errors: { rpc: { message: 'bad_action' } },
  })
  await assert.rejects(
    async () => applyTripWait(sb, { action: 'arrive', tripId: 'trip_1', actorId: 'actor_1' }),
    (err) => {
      assert.equal(err.status, 400)
      assert.equal(err.message, 'Unknown wait action')
      return true
    },
  )
})

test('applyTripWait maps generic RPC error to 500', async () => {
  const sb = createMockSb({
    errors: { rpc: { message: 'Unexpected database crash' } },
  })
  await assert.rejects(
    async () => applyTripWait(sb, { action: 'arrive', tripId: 'trip_1', actorId: 'actor_1' }),
    (err) => {
      assert.equal(err.status, 500)
      assert.equal(err.message, 'Unexpected database crash')
      return true
    },
  )
})

test('applyTripWait throws 500 when RPC returns no trip data or missing trip.id', async () => {
  const sbNoData = createMockSb({
    rpc: async () => ({ data: null, error: null }),
  })
  await assert.rejects(
    async () => applyTripWait(sbNoData, { action: 'arrive', tripId: 'trip_1', actorId: 'actor_1' }),
    (err) => {
      assert.equal(err.status, 500)
      assert.equal(err.message, 'Wait update returned no trip')
      return true
    },
  )

  const sbNoTripId = createMockSb({
    rpc: async () => ({ data: { trip: {} }, error: null }),
  })
  await assert.rejects(
    async () => applyTripWait(sbNoTripId, { action: 'arrive', tripId: 'trip_1', actorId: 'actor_1' }),
    (err) => {
      assert.equal(err.status, 500)
      assert.equal(err.message, 'Wait update returned no trip')
      return true
    },
  )
})

// ===========================================================================
// 11. applyTripWait(sb, { action, tripId, actorId }) - Success Flows
// ===========================================================================

test('applyTripWait handles non-charging actions (arrive, tick, start) returning charge: null and quote', async () => {
  const arrivedAt = new Date('2026-09-25T10:00:00.000Z').toISOString()
  const serverNow = new Date('2026-09-25T10:02:30.000Z').toISOString() // 2m30s elapsed (in grace)

  const trip = {
    id: 'trip_arrive_1',
    rider_id: 'rider_1',
    driver_id: 'driver_1',
    status: 'arrived',
    arrived_at: arrivedAt,
    wait_fee_cents: 0,
  }

  let rpcCalledWith = null
  const sb = createMockSb({
    rpc: async (fn, args) => {
      rpcCalledWith = { fn, args }
      return {
        data: {
          trip,
          should_charge: false,
          server_now: serverNow,
        },
        error: null,
      }
    },
  })

  const res = await applyTripWait(sb, {
    action: 'arrive',
    tripId: 'trip_arrive_1',
    actorId: 'driver_1',
  })

  assert.equal(rpcCalledWith.fn, 'trip_wait_apply')
  assert.deepEqual(rpcCalledWith.args, {
    p_trip_id: 'trip_arrive_1',
    p_action: 'arrive',
    p_actor: 'driver_1',
  })

  assert.deepEqual(res.trip, trip)
  assert.equal(res.serverNow, serverNow)
  assert.equal(res.charge, null)

  // Verify quoteWait calculations
  assert.equal(res.quote.inGrace, true)
  assert.equal(res.quote.waitFeeCents, 0)
  assert.equal(res.quote.clock, '2:30')
  assert.equal(res.quote.cancelAvailable, false)
  assert.equal(res.quote.autoDue, false)
})

test('applyTripWait falls back to current ISO time when server_now is not returned', async () => {
  const trip = {
    id: 'trip_notime',
    rider_id: 'rider_1',
    status: 'arrived',
    arrived_at: null,
  }

  const sb = createMockSb({
    rpc: async () => ({
      data: { trip, should_charge: false, server_now: null },
      error: null,
    }),
  })

  const res = await applyTripWait(sb, {
    action: 'tick',
    tripId: 'trip_notime',
    actorId: 'driver_1',
  })

  assert.ok(res.serverNow)
  assert.equal(typeof res.serverNow, 'string')
  assert.equal(res.quote.waitFeeCents, 0)
  assert.equal(res.charge, null)
})

test('applyTripWait safely falls back when server_now is an invalid date string', async () => {
  const sb = createMockSb({
    rpc: async () => ({
      data: {
        trip: { id: 'trip_invalid_date', arrived_at: new Date().toISOString() },
        should_charge: false,
        server_now: 'not-a-valid-iso-date',
      },
      error: null,
    }),
  })

  const res = await applyTripWait(sb, {
    action: 'tick',
    tripId: 'trip_invalid_date',
    actorId: 'driver_1',
  })

  assert.equal(res.serverNow, 'not-a-valid-iso-date')
  assert.equal(typeof res.quote.clock, 'string')
  assert.notEqual(res.quote.clock, 'NaN:NaN')
  assert.ok(Number.isFinite(res.quote.elapsedMs))
  assert.equal(res.charge, null)
})

test('applyTripWait executes chargeWaitFees when should_charge is true (cancel or complete)', async () => {
  stripeHandlers.create = async () => ({ id: 'pi_apply_charged', status: 'succeeded' })

  const arrivedAt = new Date('2026-09-25T10:00:00.000Z').toISOString()
  const serverNow = new Date('2026-09-25T10:07:00.000Z').toISOString() // 7 min (auto-cancel)

  const trip = {
    id: 'trip_cancel_1',
    rider_id: 'rider_1',
    driver_id: 'driver_1',
    status: 'cancelled_wait',
    arrived_at: arrivedAt,
    wait_fee_cents: 400,
    cancel_fee_cents: 100,
    platform_fee_cents: 100,
    wait_cancel_reason: 'auto',
  }

  const sb = createMockSb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' }],
    rpc: async () => ({
      data: {
        trip,
        should_charge: true,
        server_now: serverNow,
      },
      error: null,
    }),
  })

  const res = await applyTripWait(sb, {
    action: 'cancel',
    tripId: 'trip_cancel_1',
    actorId: 'driver_1',
  })

  assert.deepEqual(res.trip, trip)
  assert.equal(res.serverNow, serverNow)
  assert.ok(res.charge)
  assert.equal(res.charge.status, 'succeeded')
  assert.equal(res.charge.paymentIntentId, 'pi_apply_charged')
  assert.equal(res.charge.amountCents, 500)
  assert.equal(res.charge.waitFeeCents, 400)
  assert.equal(res.charge.cancelFeeCents, 100)

  // Verify quote shows 7:00
  assert.equal(res.quote.clock, '7:00')
  assert.equal(res.quote.autoDue, true)
})

test('// BUG?: quoteWait in applyTripWait calculates elapsed from trip.arrived_at to serverNow even for completed trips', async () => {
  // BUG?: For a completed trip that had 2 minutes of wait time frozen on the trip row,
  // applyTripWait calculates `quote` from trip.arrived_at to serverNow (which could be 30m later),
  // showing capped 7:00 and $4 wait fee in `quote` despite trip.wait_fee_cents being $0.
  const arrivedAt = new Date('2026-09-25T10:00:00.000Z').toISOString()
  const tripCompletedAt = new Date('2026-09-25T10:30:00.000Z').toISOString() // 30 mins later

  const trip = {
    id: 'trip_completed_long',
    rider_id: 'rider_1',
    driver_id: 'driver_1',
    status: 'completed',
    arrived_at: arrivedAt,
    wait_fee_cents: 0, // wait was frozen at 2 min (in grace, $0)
  }

  const sb = createMockSb({
    rpc: async () => ({
      data: {
        trip,
        should_charge: false,
        server_now: tripCompletedAt,
      },
      error: null,
    }),
  })

  const res = await applyTripWait(sb, {
    action: 'complete',
    tripId: 'trip_completed_long',
    actorId: 'driver_1',
  })

  // Documents current behavior: quote reflects elapsed time from arrived_at to serverNow
  assert.equal(res.quote.displayMs, 7 * 60 * 1000)
  assert.equal(res.quote.clock, '7:00')
  assert.equal(res.quote.waitFeeCents, 400) // quote reports $4 even though trip.wait_fee_cents is 0
  assert.equal(res.trip.wait_fee_cents, 0)
})
