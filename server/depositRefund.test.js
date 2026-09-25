/**
 * 25% deposit (depositCents) and POST /api/airport-checkout with injected fakes.
 * No network, no Stripe SDK, no service-role client.
 *
 * Handler deps actually read:
 *   sb, user (null is "signed out"; omitted would call userFromAuth),
 *   ensureProfile, stripeOk, stripe (else stripeClient / stripeClient()).
 * Fare, routes, credits, and the cancel-on-Stripe-failure path are not
 * injected — the fake sb has to answer those queries.
 */
import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { register } from 'node:module'
import { depositCents } from '../src/lib/stripeCheckout.js'
import {
  MIN_CARD_CHARGE_CENTS,
  cardDepositCents,
  quoteFare,
  splitPlatformFee,
} from '../src/lib/fareRates.js'
import { quoteAirportCheckout } from './authoritativeFare.js'
import { studentDiscountGranted } from '../src/lib/studentDomain.js'

delete process.env.GOOGLE_MAPS_API_KEY
delete process.env.GOOGLE_ROUTES_API_KEY

// pricing.js (pulled in by midrideCancel.js) uses Vite-style extensionless
// specifiers. Node ESM will not load that graph unless a resolver adds .js.
await register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, nextResolve) {
    const needsJs = (specifier.startsWith('.') || specifier.startsWith('/'))
      && !/\\.(js|mjs|cjs|json|node)$/.test(specifier)
    if (needsJs) {
      try { return await nextResolve(specifier + '.js', context) } catch { /* fall through */ }
    }
    return nextResolve(specifier, context)
  }`,
))

const { googleMapsKey } = await import('./friendRideLib.js')
if (googleMapsKey) {
  throw new Error('airport checkout tests refuse to start with a Google routes key loaded')
}

const { default: airportCheckout } = await import('./endpoints/airportCheckout.js')
const {
  formatMidrideMoney,
  isPaymentRequired,
  paymentRequiredMessage,
  midrideChargeSummary,
} = await import('../src/lib/midrideCancel.js')

const QUIET_BODY = { airport: 'GSP', date: '2026-09-23', time: '11:00' }

const GMAIL = {
  id: 'rider_gmail',
  email: 'ada@gmail.com',
  email_confirmed_at: '2026-01-01T00:00:00Z',
}

const TIGER = {
  id: 'rider_tiger',
  email: 'tiger@g.clemson.edu',
  email_confirmed_at: '2026-01-01T00:00:00Z',
}

function rideAt(body) {
  const hhmm = body.time || '12:00'
  return new Date(`${body.date}T${hhmm}:00`)
}

function expectedQuote(body, user) {
  return quoteAirportCheckout({
    airport: body.airport,
    at: body.date ? rideAt(body) : new Date(),
    isStudent: studentDiscountGranted(user),
    gameDayMultiplier: null,
  })
}

function createCheckoutSb(initial = {}) {
  const tables = {
    profiles: (initial.profiles || []).map((row) => ({ ...row })),
    game_day_events: [],
    rider_credit_lots: [],
    trips: [],
    payments: [],
    trip_events: [],
  }
  const rpcCalls = []
  let tripSeq = 0

  function match(row, filters) {
    return filters.every((filter) => {
      const value = row[filter.col]
      if (filter.op === 'eq') return value === filter.val
      if (filter.op === 'gt') return value > filter.val
      if (filter.op === 'gte') return value >= filter.val
      if (filter.op === 'lte') return value <= filter.val
      if (filter.op === 'in') return filter.val.includes(value)
      return false
    })
  }

  function from(table) {
    if (!tables[table]) tables[table] = []
    const state = { filters: [], op: 'select', payload: null, limit: null, order: null }

    function finish(one) {
      const rows = tables[table]
      if (state.op === 'insert') {
        const row = { ...state.payload }
        if (table === 'trips' && !row.id) {
          tripSeq += 1
          row.id = `trip_${tripSeq}`
        }
        if (!row.id) row.id = `${table}_${rows.length + 1}`
        rows.push(row)
        return { data: one ? { id: row.id } : row, error: null }
      }
      if (state.op === 'update') {
        const matched = rows.filter((row) => match(row, state.filters))
        for (const row of matched) Object.assign(row, state.payload)
        return { data: matched.map((row) => ({ ...row })), error: null }
      }
      let found = rows.filter((row) => match(row, state.filters))
      if (state.order) {
        const { col, ascending } = state.order
        found = [...found].sort((a, b) => {
          if (a[col] === b[col]) return 0
          if (a[col] == null) return 1
          if (b[col] == null) return -1
          const cmp = a[col] < b[col] ? -1 : 1
          return ascending ? cmp : -cmp
        })
      }
      if (state.limit != null) found = found.slice(0, state.limit)
      if (one) return { data: found[0] ? { ...found[0] } : null, error: null }
      return { data: found.map((row) => ({ ...row })), error: null }
    }

    const api = {
      select() { return api },
      insert(payload) { state.op = 'insert'; state.payload = payload; return api },
      update(payload) { state.op = 'update'; state.payload = payload; return api },
      eq(col, val) { state.filters.push({ op: 'eq', col, val }); return api },
      gt(col, val) { state.filters.push({ op: 'gt', col, val }); return api },
      gte(col, val) { state.filters.push({ op: 'gte', col, val }); return api },
      lte(col, val) { state.filters.push({ op: 'lte', col, val }); return api },
      in(col, val) { state.filters.push({ op: 'in', col, val }); return api },
      order(col, opts = {}) { state.order = { col, ascending: opts.ascending !== false }; return api },
      limit(n) { state.limit = n; return api },
      maybeSingle() { return Promise.resolve(finish(true)) },
      single() { return Promise.resolve(finish(true)) },
      then(resolve, reject) { return Promise.resolve(finish(false)).then(resolve, reject) },
    }
    return api
  }

  return {
    tables,
    rpcCalls,
    from,
    async rpc(name, params = {}) {
      rpcCalls.push({ name, params })
      if (name !== 'merge_trip_metadata') {
        return { data: null, error: { message: `unknown rpc ${name}` } }
      }
      const trip = tables.trips.find((row) => row.id === params.p_trip_id)
      if (!trip) return { data: null, error: null }
      if (params.p_expected_statuses && !params.p_expected_statuses.includes(trip.status)) {
        return { data: null, error: null }
      }
      if (params.p_require_unassigned && trip.driver_id != null) {
        return { data: null, error: null }
      }
      const abandoned = trip.metadata && typeof trip.metadata === 'object'
        ? trip.metadata.checkout_abandoned
        : null
      if (params.p_require_unabandoned && abandoned != null) {
        return { data: null, error: null }
      }
      trip.metadata = { ...(trip.metadata || {}), ...(params.p_patch || {}) }
      if (params.p_new_status) trip.status = params.p_new_status
      if (params.p_canceled_at) trip.canceled_at = params.p_canceled_at
      if (params.p_clear_claim) trip.hold_expire_claimed_at = null
      return {
        data: { id: trip.id, status: trip.status, metadata: trip.metadata, canceled_at: trip.canceled_at || null },
        error: null,
      }
    },
  }
}

function createFakeStripe() {
  const sessions = []
  return {
    sessions,
    customers: {
      async create(params) {
        return { id: `cus_created_${sessions.length + 1}`, ...params }
      },
    },
    checkout: {
      sessions: {
        async create(params, options) {
          const key = options?.idempotencyKey || null
          if (key) {
            const prior = sessions.find((row) => row.options?.idempotencyKey === key)
            if (prior) return prior.session
          }
          const session = {
            id: `cs_test_${sessions.length + 1}`,
            url: `https://checkout.test/${sessions.length + 1}`,
          }
          sessions.push({ params, options: options ?? null, session })
          return session
        },
      },
    },
  }
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value
    },
    end(payload) {
      this.body = payload == null ? '' : String(payload)
    },
  }
}

function readJson(res) {
  return res.body ? JSON.parse(res.body) : null
}

async function invoke(req, deps) {
  const res = mockRes()
  await airportCheckout(req, res, deps)
  return { res, json: readJson(res) }
}

function riderProfile(user, customerId) {
  return {
    id: user.id,
    email: user.email,
    full_name: 'Test Rider',
    stripe_customer_id: customerId,
  }
}

describe('depositCents', () => {
  test('rounds 25% of odd-cent fares to the nearest cent', () => {
    // 1001 * 0.25 = 250.25 → 250; 1003 * 0.25 = 250.75 → 251
    assert.equal(depositCents(1001), 250)
    assert.equal(depositCents(1003), 251)
    // 401 * 0.25 = 100.25 → 100; 403 * 0.25 = 100.75 → 101
    assert.equal(depositCents(401), 100)
    assert.equal(depositCents(403), 101)
    assert.equal(depositCents('1001'), 250)
    // Cash is rounded to cents before the quarter is taken.
    assert.equal(depositCents(100.4), depositCents(100))
    assert.equal(depositCents(100.6), depositCents(101))
    assert.equal(depositCents(1001), cardDepositCents(1001))
  })

  test('is 0 for zero, negative, NaN, and non-numeric input', () => {
    for (const value of [0, -0, -1, -100, -0.6, -1e15, NaN, undefined, null, 'nope', '', false]) {
      assert.equal(depositCents(value), 0, `depositCents(${String(value)})`)
    }
  })

  test('takes 25% of a huge fare without flipping sign or dropping the quarter', () => {
    assert.equal(depositCents(8_000_000_000), 2_000_000_000)
    // 10_000_000_001 * 0.25 = 2_500_000_000.25 → 2_500_000_000
    assert.equal(depositCents(10_000_000_001), 2_500_000_000)
    // 10_000_000_003 * 0.25 = 2_500_000_000.75 → 2_500_000_001
    assert.equal(depositCents(10_000_000_003), 2_500_000_001)
    assert.equal(depositCents(Number.MAX_SAFE_INTEGER), 2_251_799_813_685_248)
    assert.ok(depositCents(Number.MAX_SAFE_INTEGER) > 0)
    assert.ok(depositCents(Number.MAX_SAFE_INTEGER) < Number.MAX_SAFE_INTEGER)
  })

  test('of a student-discounted fare is 25% of the discounted fare, not the full fare', () => {
    const full = quoteFare({ miles: 48, minutes: 55, isStudent: false, tier: 'standard' })
    const student = quoteFare({ miles: 48, minutes: 55, isStudent: true, tier: 'standard' })
    assert.ok(student.breakdown.student_discount_cents > 0)
    assert.ok(student.fareBeforeCreditsCents < full.fareBeforeCreditsCents)
    assert.equal(depositCents(student.fareBeforeCreditsCents), Math.round(student.fareBeforeCreditsCents * 0.25))
    assert.equal(depositCents(full.fareBeforeCreditsCents), Math.round(full.fareBeforeCreditsCents * 0.25))
    assert.ok(depositCents(student.fareBeforeCreditsCents) < depositCents(full.fareBeforeCreditsCents))
    // depositCents does not itself apply the student percent.
    assert.notEqual(
      depositCents(full.fareBeforeCreditsCents),
      depositCents(student.fareBeforeCreditsCents),
    )
  })

  test('raises a card remainder to the Stripe minimum and waives cash below it', () => {
    assert.equal(MIN_CARD_CHARGE_CENTS, 50)
    assert.equal(depositCents(1), 0)
    assert.equal(depositCents(40), 0)
    assert.equal(depositCents(49), 0)
    assert.equal(depositCents(50), 50)
    assert.equal(depositCents(51), 50)
    assert.equal(depositCents(100), 50)
    assert.equal(depositCents(196), 50)
    assert.equal(depositCents(199), 50)
    assert.equal(depositCents(200), 50)
    assert.equal(depositCents(201), 50)
    // 203 * 0.25 = 50.75 → 51, so the minimum no longer lifts the quarter.
    assert.equal(depositCents(203), 51)
  })
})

describe('airport checkout handler', () => {
  test('method guard and missing auth', async () => {
    const sb = createCheckoutSb()
    const stripe = createFakeStripe()
    const baseDeps = {
      sb,
      stripe,
      stripeOk: () => true,
      ensureProfile: async () => ({ ok: true }),
    }

    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const denied = await invoke({ method, body: QUIET_BODY, headers: {} }, { ...baseDeps, user: GMAIL })
      assert.equal(denied.res.statusCode, 405)
      assert.deepEqual(denied.json, { error: 'Method not allowed' })
    }

    const preflight = await invoke(
      { method: 'OPTIONS', body: QUIET_BODY, headers: {} },
      { ...baseDeps, user: null },
    )
    assert.equal(preflight.res.statusCode, 204)

    const signedOut = await invoke(
      { method: 'POST', body: QUIET_BODY, headers: {} },
      { ...baseDeps, user: null },
    )
    assert.equal(signedOut.res.statusCode, 401)
    assert.deepEqual(signedOut.json, { error: 'Sign in required' })

    const badJson = await invoke(
      { method: 'POST', body: '{', headers: {} },
      { ...baseDeps, user: GMAIL },
    )
    assert.equal(badJson.res.statusCode, 400)
    assert.equal(badJson.json.error, 'Invalid JSON')

    const unknown = await invoke(
      { method: 'POST', body: { airport: 'ATL' }, headers: {} },
      { ...baseDeps, user: GMAIL },
    )
    assert.equal(unknown.res.statusCode, 400)
    assert.equal(unknown.json.error, 'Unknown airport')

    assert.equal(sb.tables.trips.length, 0)
    assert.equal(stripe.sessions.length, 0)
  })

  test('fare mismatch: Stripe is charged 25% of the authoritative fare', async () => {
    const sb = createCheckoutSb({
      profiles: [riderProfile(GMAIL, 'cus_test_ada')],
    })
    const stripe = createFakeStripe()
    const body = {
      ...QUIET_BODY,
      fareCents: 100,
      fare_cents: 100,
      depositCents: 25,
      amount: 25,
      total: 1,
      isStudent: true,
    }
    const priced = expectedQuote(body, GMAIL)
    assert.equal(studentDiscountGranted(GMAIL), false)
    assert.ok(priced.fareCents > body.fareCents)
    assert.ok(priced.depositCents > body.depositCents)

    const { res, json } = await invoke(
      { method: 'POST', body, headers: {} },
      {
        sb,
        user: GMAIL,
        stripe,
        stripeOk: () => true,
        ensureProfile: async () => ({ ok: true }),
      },
    )

    assert.equal(res.statusCode, 200)
    assert.equal(stripe.sessions.length, 1)
    const params = stripe.sessions[0].params
    const unit = params.line_items[0].price_data.unit_amount
    assert.equal(unit, priced.depositCents)
    assert.equal(unit, depositCents(priced.fareCents))
    assert.equal(unit, Math.round(priced.fareCents * 0.25))
    assert.notEqual(unit, body.depositCents)
    assert.ok(unit < priced.fareCents)
    assert.equal(params.line_items[0].price_data.currency, 'usd')
    assert.match(params.line_items[0].price_data.product_data.name, /GSP deposit \(25%\)/)
    assert.equal(params.customer, 'cus_test_ada')
    assert.equal(params.metadata.kind, 'airport_deposit')
    assert.equal(params.metadata.depositCents, String(unit))
    assert.equal(params.metadata.fareCents, String(priced.fareCents))
    assert.equal(json.depositCents, unit)
    assert.equal(json.fareCents, priced.fareCents)
    assert.equal(json.studentDiscountApplied, false)
    assert.equal(json.currency, 'usd')
    assert.equal(json.routeSource, 'fallback')
    assert.equal(json.url, stripe.sessions[0].session.url)
    const fee = splitPlatformFee(unit)
    assert.equal(json.platformFeeCents, fee.platformFeeCents)
    assert.equal(json.driverEarningsCents, fee.driverEarningsCents)

    assert.equal(sb.tables.trips.length, 1)
    const trip = sb.tables.trips[0]
    assert.equal(trip.status, 'scheduled')
    assert.equal(trip.rider_id, GMAIL.id)
    assert.equal(trip.fare_cents, priced.fareCents)
    assert.equal(trip.deposit_cents, unit)
    assert.equal(trip.metadata.stripe_checkout_session_id, json.id)
    assert.equal(sb.tables.payments.length, 0)
  })

  test('confirmed Clemson email deposits 25% of the discounted fare, ignoring a higher client amount', async () => {
    const full = expectedQuote(QUIET_BODY, GMAIL)
    const studentQuote = expectedQuote(QUIET_BODY, TIGER)
    assert.equal(studentDiscountGranted(TIGER), true)
    assert.ok(studentQuote.depositCents < full.depositCents)
    assert.equal(studentQuote.depositCents, depositCents(studentQuote.fareCents))

    const sb = createCheckoutSb({
      profiles: [riderProfile(TIGER, 'cus_test_tiger')],
    })
    const stripe = createFakeStripe()
    const body = {
      ...QUIET_BODY,
      fareCents: 999999,
      depositCents: 999999,
      isStudent: false,
    }
    const { res, json } = await invoke(
      { method: 'POST', body, headers: {} },
      {
        sb,
        user: TIGER,
        stripe,
        stripeOk: () => true,
        ensureProfile: async () => ({ ok: true }),
      },
    )

    assert.equal(res.statusCode, 200)
    const unit = stripe.sessions[0].params.line_items[0].price_data.unit_amount
    assert.equal(unit, studentQuote.depositCents)
    assert.equal(unit, Math.round(studentQuote.fareCents * 0.25))
    assert.notEqual(unit, body.depositCents)
    assert.equal(json.fareCents, studentQuote.fareCents)
    assert.equal(json.depositCents, unit)
    assert.equal(json.studentDiscountApplied, true)
    assert.equal(sb.tables.trips[0].fare_cents, studentQuote.fareCents)
    assert.equal(sb.tables.trips[0].deposit_cents, unit)
  })

  test('payments unavailable returns the authoritative deposit and does not open a trip', async () => {
    const sb = createCheckoutSb()
    const stripe = createFakeStripe()
    let ensured = 0
    const body = { ...QUIET_BODY, fareCents: 100, depositCents: 1 }
    const priced = expectedQuote(body, GMAIL)
    const { res, json } = await invoke(
      { method: 'POST', body, headers: {} },
      {
        sb,
        user: GMAIL,
        stripe,
        stripeOk: () => false,
        ensureProfile: async () => {
          ensured += 1
          return { ok: true }
        },
      },
    )

    assert.equal(res.statusCode, 503)
    assert.equal(json.error, 'Payments unavailable')
    assert.equal(json.depositCents, priced.depositCents)
    assert.equal(json.depositCents, depositCents(priced.fareCents))
    assert.equal(json.fareCents, priced.fareCents)
    assert.equal(json.remainingCents, priced.fareCents - priced.depositCents)
    assert.notEqual(json.depositCents, body.depositCents)
    assert.equal(ensured, 0)
    assert.equal(sb.tables.trips.length, 0)
    assert.equal(stripe.sessions.length, 0)
  })

  test('idempotency key reuse: a repeated POST is not deduped', async () => {
    // BUG?: stripe.checkout.sessions.create is called with no idempotencyKey.
    // The fake above WOULD return the first session if the same key were sent
    // again. A retried POST, even one that carries Idempotency-Key, opens a
    // second scheduled trip and a second Checkout Session instead.
    const sb = createCheckoutSb({
      profiles: [riderProfile(GMAIL, 'cus_test_ada')],
    })
    const stripe = createFakeStripe()
    const deps = {
      sb,
      user: GMAIL,
      stripe,
      stripeOk: () => true,
      ensureProfile: async () => ({ ok: true }),
    }
    const headers = { 'Idempotency-Key': 'airport-deposit-retry-1', 'idempotency-key': 'airport-deposit-retry-1' }
    const body = { ...QUIET_BODY, fareCents: 100, depositCents: 25 }

    const first = await invoke({ method: 'POST', body, headers }, deps)
    const second = await invoke({ method: 'POST', body, headers }, deps)

    assert.equal(first.res.statusCode, 200)
    assert.equal(second.res.statusCode, 200)
    assert.equal(stripe.sessions.length, 2)
    assert.equal(stripe.sessions[0].options, null)
    assert.equal(stripe.sessions[1].options, null)
    assert.equal(stripe.sessions[0].params.idempotencyKey, undefined)
    assert.equal(stripe.sessions[1].params.idempotencyKey, undefined)
    assert.notEqual(first.json.id, second.json.id)
    assert.notEqual(first.json.tripId, second.json.tripId)
    assert.equal(first.json.depositCents, second.json.depositCents)
    assert.equal(sb.tables.trips.length, 2)
    assert.equal(sb.tables.trips[0].status, 'scheduled')
    assert.equal(sb.tables.trips[1].status, 'scheduled')
    assert.equal(sb.tables.trips[0].metadata.stripe_checkout_session_id, first.json.id)
    assert.equal(sb.tables.trips[1].metadata.stripe_checkout_session_id, second.json.id)
  })

  test('Stripe error returns a clean 500 and cancels the trip it just inserted', async () => {
    const sb = createCheckoutSb({
      profiles: [riderProfile(GMAIL, 'cus_test_ada')],
    })
    const stripe = createFakeStripe()
    stripe.checkout.sessions.create = async () => {
      throw new Error('stripe down')
    }
    const priced = expectedQuote(QUIET_BODY, GMAIL)
    const errors = []
    const orig = console.error
    console.error = (...args) => { errors.push(args) }
    try {
      const { res, json } = await invoke(
        { method: 'POST', body: { ...QUIET_BODY, depositCents: 1 }, headers: {} },
        {
          sb,
          user: GMAIL,
          stripe,
          stripeOk: () => true,
          ensureProfile: async () => ({ ok: true }),
        },
      )

      assert.equal(res.statusCode, 500)
      assert.deepEqual(json, { error: 'stripe down', tripId: sb.tables.trips[0].id })
      assert.equal(json.stack, undefined)
      assert.equal(json.url, undefined)
      assert.equal(sb.tables.trips.length, 1)
      const trip = sb.tables.trips[0]
      assert.equal(trip.status, 'canceled')
      assert.notEqual(trip.status, 'searching')
      assert.notEqual(trip.status, 'scheduled')
      assert.ok(trip.canceled_at)
      assert.equal(trip.deposit_cents, priced.depositCents)
      assert.equal(trip.metadata.checkout_abandoned.reason, 'checkout_create_failed')
      assert.equal(trip.metadata.checkout_abandoned.source, 'airport_checkout')
      assert.equal(trip.metadata.stripe_checkout_session_id, undefined)
      assert.equal(sb.tables.payments.length, 0)
      assert.equal(sb.tables.trip_events.length, 1)
      assert.equal(sb.tables.trip_events[0].kind, 'canceled')
      assert.equal(sb.tables.trip_events[0].trip_id, trip.id)
    } finally {
      console.error = orig
    }
    assert.equal(errors.length, 1)
  })
})

describe('midrideCancel helpers', () => {
  test('formatMidrideMoney formats cents as USD', () => {
    assert.equal(formatMidrideMoney(2500), '$25.00')
    assert.equal(formatMidrideMoney(1050), '$10.50')
    assert.equal(formatMidrideMoney(0), '$0.00')
    assert.equal(formatMidrideMoney(null), '$0.00')
    assert.equal(formatMidrideMoney(undefined), '$0.00')
  })

  test('isPaymentRequired and paymentRequiredMessage', () => {
    for (const paymentStatus of ['payment_required', 'failed', 'requires_payment_method']) {
      assert.equal(isPaymentRequired({ paymentStatus }), true, paymentStatus)
    }
    for (const paymentStatus of ['succeeded', 'processing', 'canceled', '', 'payment_required ']) {
      assert.equal(isPaymentRequired({ paymentStatus }), false, paymentStatus)
    }
    assert.equal(isPaymentRequired(null), false)
    assert.equal(isPaymentRequired(undefined), false)
    assert.equal(isPaymentRequired({}), false)

    assert.equal(paymentRequiredMessage({ paymentStatus: 'succeeded', toCollectCents: 500 }), null)
    assert.equal(
      paymentRequiredMessage({ paymentStatus: 'payment_required', toCollectCents: 1050, obligationCents: 2500 }),
      'Payment required. The ride has ended, but $10.50 still needs a card.',
    )
    assert.equal(
      paymentRequiredMessage({ paymentStatus: 'failed', obligationCents: 2500 }),
      'Payment required. The ride has ended, but $25.00 still needs a card.',
    )
    // toCollectCents of 0 is falsy, so the message falls through to the obligation.
    assert.equal(
      paymentRequiredMessage({ paymentStatus: 'requires_payment_method', toCollectCents: 0, obligationCents: 1500 }),
      'Payment required. The ride has ended, but $15.00 still needs a card.',
    )
  })

  test('midrideChargeSummary covers deposit-paid, partial, and no-deposit quotes', () => {
    assert.equal(midrideChargeSummary(null), '')
    assert.equal(midrideChargeSummary(undefined), '')

    const covered = {
      obligationCents: 2500,
      cancelFeeCents: 500,
      ridePortionCents: 2000,
      toCollectCents: 0,
      depositPaidCents: 2500,
    }
    assert.equal(
      midrideChargeSummary(covered),
      '$25.00 trip charge ($20.00 so far + $5.00 cancel fee). Your deposit covers it — no extra card charge.',
    )

    const partial = { ...covered, toCollectCents: 1000, depositPaidCents: 1500 }
    assert.equal(
      midrideChargeSummary(partial),
      '$25.00 trip charge ($20.00 so far + $5.00 cancel fee). Card charge now $10.00 after your deposit.',
    )

    const bare = { ...covered, toCollectCents: 2500, depositPaidCents: 0 }
    assert.equal(
      midrideChargeSummary(bare),
      '$25.00 ($20.00 for distance and time so far + $5.00 cancel fee).',
    )
  })
})
