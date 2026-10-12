import assert from 'node:assert/strict'
import test from 'node:test'
import { DEMO_FLEET } from '../shared/demoFleet.js'
import { AMBASSADOR_CENTS_PER_SEAT } from '../src/lib/carpoolEngine.js'
import { fareAuthorizationCents } from '../shared/fareAuthorization.js'
import { holdQuoteCents } from '../shared/scheduledBoost.js'
import { listAssignableDrivers } from './autoAssign.js'
import { settleCarpoolSideEffects } from './carpoolSettle.js'
import requestDriverTrip from './endpoints/requestDriverTrip.js'
import { authorizeRideRequest, releaseOpenFareHold } from './fareAuthorization.js'
import { loadNearTermOffer } from './nearTermAvailability.js'
import {
  attemptCancelFeePayout,
  attemptStandbyBackupPayout,
  enqueueAndAttemptPayout,
  writePayout,
} from './payouts.js'
import { seedMatchingScenario } from '../tests/fixtures/matchingE2E.js'

const REAL_DRIVER = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-10-05T15:00:00Z')
const PICKUP = { lat: 34.6788, lng: -82.843 }

function response() {
  return {
    headers: {},
    statusCode: 0,
    setHeader(key, value) { this.headers[key] = value },
    end(body) { this.body = JSON.parse(body) },
  }
}

function memoryDb(seed = {}) {
  const tables = {
    profiles: [...(seed.profiles || [])],
    trips: [...(seed.trips || [])],
    payments: [...(seed.payments || [])],
  }

  function from(table) {
    if (!tables[table]) tables[table] = []
    const rows = tables[table]
    const state = { op: 'select', filters: [], payload: null }

    function matches(row) {
      return state.filters.every(([col, val, kind]) => (
        kind === 'in' ? val.includes(row[col]) : row[col] === val
      ))
    }

    function run(one) {
      if (state.op === 'insert') {
        const row = { id: state.payload.id || `${table}_${rows.length + 1}`, ...state.payload }
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
      eq(col, val) { state.filters.push([col, val, 'eq']); return api },
      in(col, val) { state.filters.push([col, val, 'in']); return api },
      maybeSingle() { return Promise.resolve(run(true)) },
      single() { return Promise.resolve(run(true)) },
      then(resolve, reject) { return Promise.resolve(run(false)).then(resolve, reject) },
    }
    return api
  }

  return { tables, from }
}

function stripeCreates() {
  const calls = []
  return {
    calls,
    paymentIntents: {
      async create(params, options) {
        calls.push({ op: 'create', params, options })
        return { id: `pi_${calls.length}`, status: 'requires_capture', amount: params.amount }
      },
      async cancel(id) {
        calls.push({ op: 'cancel', id })
        return { id, status: 'canceled' }
      },
      async retrieve(id) {
        calls.push({ op: 'retrieve', id })
        return { id, status: 'requires_capture', amount: 1200 }
      },
    },
    paymentMethods: { async list() { return { data: [] } } },
  }
}

test('pre-auth skips a credits fare and still holds a booked backup bonus', async () => {
  const stripe = stripeCreates()
  const credits = await authorizeRideRequest({
    sb: memoryDb(),
    stripe,
    trip: {
      id: 'trip_credits',
      rider_id: 'rider_1',
      fare_cents: 6400,
      metadata: { billing_choice: 'credits' },
    },
  })
  assert.equal(credits.skipped, true)
  assert.equal(credits.reason, 'credits')
  assert.equal(stripe.calls.length, 0)

  const bonus = 1000
  const quote = holdQuoteCents(bonus, 0)
  const db = memoryDb({
    profiles: [{ id: 'rider_1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' }],
    trips: [{
      id: 'trip_bonus',
      rider_id: 'rider_1',
      fare_cents: 6400,
      metadata: { billing_choice: 'credits', backup_queue: { enabled: true, bonusCents: bonus } },
    }],
  })
  const placed = await authorizeRideRequest({ sb: db, stripe, trip: db.tables.trips[0] })
  assert.equal(placed.ok, true)
  assert.equal(placed.authorization.authorizationCents, quote.authorizationCents)
  assert.equal(placed.authorization.estimatedFareCents, bonus)
  assert.equal(stripe.calls.at(-1).params.amount, quote.authorizationCents)
  assert.equal(stripe.calls.at(-1).params.capture_method, 'manual')
  assert.equal(db.tables.payments[0].kind, 'balance')
  assert.equal(db.tables.payments[0].status, 'pending')
  assert.equal(db.tables.payments[0].metadata.estimated_fare_cents, bonus)
  assert.equal(db.tables.payments[0].metadata.buffer_cents, quote.bufferCents)
  assert.notEqual(quote.authorizationCents, fareAuthorizationCents(6400).authorizationCents)
})

test('pre-auth with no saved card parks the estimate and does not create a PaymentIntent', async () => {
  const stripe = stripeCreates()
  const db = memoryDb({
    profiles: [{ id: 'rider_1' }],
    trips: [{ id: 'trip_nocard', rider_id: 'rider_1', fare_cents: 2500, metadata: {} }],
  })
  const placed = await authorizeRideRequest({ sb: db, stripe, trip: db.tables.trips[0] })
  assert.equal(placed.ok, false)
  assert.equal(placed.parked, true)
  assert.equal(placed.outstanding.code, 'no_payment_method')
  assert.equal(stripe.calls.length, 0)
  assert.equal(db.tables.payments.length, 0)
  assert.equal(db.tables.trips[0].metadata.fare_authorization.status, 'failed')
  assert.equal(db.tables.trips[0].metadata.outstanding_balance.reason, 'authorization_failed')
})

test('releasing an open fare hold cancels the PaymentIntent once and closes the payment row', async () => {
  const stripe = stripeCreates()
  const trip = {
    id: 'trip_hold',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_open',
        authorizationCents: 1200,
      },
    },
  }
  const db = memoryDb({
    trips: [trip],
    payments: [{
      id: 'pay_1',
      trip_id: 'trip_hold',
      stripe_payment_intent_id: 'pi_open',
      status: 'requires_capture',
    }],
  })
  const released = await releaseOpenFareHold({ sb: db, stripe, trip, reason: 'rider_cancel' })
  assert.equal(released.ok, true)
  assert.equal(released.released, true)
  assert.deepEqual(stripe.calls.map((call) => call.op), ['retrieve', 'cancel'])
  assert.equal(db.tables.trips[0].metadata.fare_authorization.status, 'canceled')
  assert.equal(db.tables.payments[0].status, 'canceled')

  const again = await releaseOpenFareHold({ sb: db, stripe, trip, reason: 'rider_cancel' })
  assert.equal(again.skipped, true)
  assert.equal(again.reason, 'no_open_hold')
  assert.equal(stripe.calls.filter((call) => call.op === 'cancel').length, 1)
})

test('payout write and enqueue persist the transfer without a second charge', async () => {
  const writes = []
  const sb = {
    from(table) {
      const state = { op: 'select', payload: null }
      const api = {
        select() { return api },
        update(payload) { state.op = 'update'; state.payload = payload; return api },
        upsert(payload, options) { state.op = 'upsert'; state.payload = payload; state.options = options; return api },
        eq() { return api },
        maybeSingle() { return Promise.resolve({ data: { metadata: {} }, error: null }) },
        then(resolve, reject) {
          writes.push({ table, op: state.op, payload: state.payload, options: state.options })
          return Promise.resolve({ error: null }).then(resolve, reject)
        },
      }
      return api
    },
  }
  const trip = { id: 'trip_pay', driver_id: 'driver_1', fare_cents: 5000, status: 'completed', metadata: {} }
  const stored = await writePayout(sb, trip, {
    tripId: 'trip_pay',
    amountCents: 4000,
    status: 'pending',
    attempts: 0,
    lastError: null,
    nextRetryAt: null,
    stripeTransferId: null,
  })
  assert.equal(stored.error, null)
  assert.equal(stored.metadata.payout.amountCents, 4000)
  assert.equal(writes.find((row) => row.table === 'driver_payouts').payload.status, 'pending')

  const transfers = []
  const stripe = {
    transfers: {
      async create(payload, options) {
        transfers.push({ payload, options })
        return { id: 'tr_1' }
      },
    },
  }
  const paid = await enqueueAndAttemptPayout({
    sb,
    stripe,
    trip,
    connectAccountId: 'acct_1',
    now: Date.parse('2026-10-05T15:00:00Z'),
  })
  assert.equal(paid.ok, true)
  assert.equal(paid.payout.status, 'paid')
  assert.equal(paid.payout.stripeTransferId, 'tr_1')
  assert.equal(transfers.length, 1)
  assert.equal(transfers[0].payload.amount, 4000)
  assert.equal(transfers[0].payload.destination, 'acct_1')
  assert.equal(writes.filter((row) => row.table === 'driver_payouts').at(-1).payload.status, 'paid')
})

test('standby and cancel-fee payout dry runs quote the bonus and do not call Stripe', async () => {
  const queue = {
    enabled: true,
    bonusCents: 1000,
    backupDriverId: 'driver_backup',
    primaryDriverId: 'driver_primary',
    backupStoodBy: true,
    cancelFeeDriverId: 'driver_backup',
    cancelFeeCents: 500,
  }
  const trip = {
    id: 'trip_backup',
    driver_id: 'driver_primary',
    metadata: { backup_queue: queue },
  }
  let stripeCalls = 0
  const stripe = { transfers: { async create() { stripeCalls += 1; return { id: 'tr_no' } } } }
  const standby = await attemptStandbyBackupPayout({ sb: null, trip, stripe, dryRun: true })
  const cancelFee = await attemptCancelFeePayout({ sb: null, trip, stripe, dryRun: true })
  assert.equal(standby.dryRun, true)
  assert.equal(standby.payout.amountCents, 1000)
  assert.equal(standby.payout.driverId, 'driver_backup')
  assert.equal(cancelFee.dryRun, true)
  assert.equal(cancelFee.payout.amountCents, 500)
  assert.equal(cancelFee.payout.role, 'cancel_fee')
  assert.equal(stripeCalls, 0)
})

test('matching drops every demo car and still offers a real online driver', async () => {
  const ids = [REAL_DRIVER, ...DEMO_FLEET.map((car) => car.id)]
  const { supabase: sb } = seedMatchingScenario({
    drivers: ids.map((id) => ({ id, approved: true, online: true, ...PICKUP })),
  })
  for (const profile of sb._tables.profiles) {
    profile.email = `${profile.id}@example.com`
  }
  sb._tables.driver_status.forEach((row) => { row.updated_at = NOW.toISOString() })
  const offer = await loadNearTermOffer(sb, { pickup: PICKUP, now: NOW })
  assert.equal(offer.demoDriversExcluded, true)
  assert.equal(offer.availableDrivers, 1)

  const assignSb = {
    from(table) {
      return {
        select() {
          return {
            eq() {
              assert.equal(table, 'driver_status')
              return { data: ids.map((driver_id) => ({ driver_id, online: true })) }
            },
            in(_column, queried) {
              assert.deepEqual(queried, [REAL_DRIVER])
              if (table === 'driver_applications') {
                return { data: [{ profile_id: REAL_DRIVER, onboarding_status: 'approved' }] }
              }
              return { data: [{ id: REAL_DRIVER, email: 'driver@example.com' }] }
            },
          }
        },
      }
    },
  }
  const assigned = await listAssignableDrivers(assignSb)
  assert.deepEqual(assigned.drivers.map((driver) => driver.id), [REAL_DRIVER])

  for (const car of DEMO_FLEET) {
    const res = response()
    const guarded = { from() { assert.fail(`demo car ${car.id} reached the database`) } }
    await requestDriverTrip(
      { method: 'POST', headers: {}, body: { driverId: car.id } },
      res,
      { sb: guarded, user: { id: 'rider' } },
    )
    assert.equal(res.statusCode, 409)
    assert.equal(res.body.code, 'ride_option_unavailable')
  }
})

test('ambassador seat commission is $1.50 per participant and ledgers each headcount once', async () => {
  assert.equal(AMBASSADOR_CENTS_PER_SEAT, 150)
  for (const seats of [0, 1, 3]) {
    const rows = []
    const sb = {
      from() {
        return {
          upsert(payload) {
            rows.push({ ...payload })
            return { select() { return Promise.resolve({ data: [{ id: `ledger_${seats}` }], error: null }) } }
          },
        }
      },
    }
    const result = await settleCarpoolSideEffects(sb, {
      ride: {
        id: 'ride_1',
        fare_breakdown: { carpool: { shares: [] }, ambassador_code: 'amb_tiger' },
      },
      trip: { id: 'trip_1' },
      participants: Array.from({ length: seats }, (_, index) => ({ id: `p${index}`, user_id: `u${index}` })),
    })
    assert.equal(result.results.ambassador, 'ledgered')
    assert.equal(rows[0].amount_cents, seats * AMBASSADOR_CENTS_PER_SEAT)
    assert.equal(rows[0].seats, seats)
    assert.equal(rows[0].code_type, 'ambassador')
    assert.equal(rows[0].status, 'pending')
  }
})
