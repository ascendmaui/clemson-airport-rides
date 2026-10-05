import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  billingOffer,
  creditsCoverFare,
  readRideCreditBalance,
  resolveBillingChoice,
} from './rideBilling.js'
import handleBilling from './endpoints/rideBilling.js'
import requestDriverTrip from './endpoints/requestDriverTrip.js'
import scheduleTrip from './endpoints/scheduleTrip.js'
import { cardDepositCents } from '../src/lib/fareRates.js'

const SPOOF = {
  fareCents: 1,
  depositCents: 1,
  amount: 1,
  total: 1,
  isStudent: true,
}

function mockRes() {
  return {
    statusCode: 200,
    body: '',
    headers: {},
    setHeader() {},
    end(payload) {
      this.body = payload == null ? '' : String(payload)
    },
  }
}

async function call(handler, body, deps) {
  const res = mockRes()
  await handler({ method: 'POST', headers: {}, body }, res, deps)
  let json = null
  try {
    json = res.body ? JSON.parse(res.body) : null
  } catch {
    json = null
  }
  return { status: res.statusCode, json }
}

function createSb({ balance = 0, balanceMode = 'row' } = {}) {
  const state = { trips: [], creditWrites: [], balance }
  function chain(table) {
    const api = {
      select() { return api },
      eq() { return api },
      in() { return api },
      lte() { return api },
      gte() { return api },
      gt() { return api },
      order() { return api },
      limit() { return api },
      maybeSingle: async () => {
        if (table === 'credit_accounts') {
          if (balanceMode === 'missing-table') {
            return { data: null, error: { message: 'relation "credit_accounts" does not exist' } }
          }
          if (balanceMode === 'error') return { data: null, error: { message: 'timeout' } }
          if (balanceMode === 'empty') return { data: null, error: null }
          return { data: { balance_cents: state.balance }, error: null }
        }
        if (table === 'profiles') {
          if (balanceMode === 'profile') return { data: { credit_balance_cents: state.balance }, error: null }
          if (balanceMode === 'missing-table') {
            return { data: null, error: { message: 'column credit_balance_cents does not exist' } }
          }
          return { data: { credit_balance_cents: 0 }, error: null }
        }
        return { data: null, error: null }
      },
      insert(payload) {
        if (table === 'credit_accounts' || table === 'credit_ledger' || table === 'profiles') {
          state.creditWrites.push({ table, payload })
        }
        if (table === 'trips') {
          const trip = { id: `trip_${state.trips.length + 1}`, ...payload }
          state.trips.push(trip)
          const selected = {
            id: trip.id,
            status: trip.status,
            driver_id: trip.driver_id ?? null,
            dropoff_label: trip.dropoff_label,
            pickup_label: trip.pickup_label,
            pickup_at: trip.pickup_at ?? null,
            fare_cents: trip.fare_cents,
            deposit_cents: trip.deposit_cents,
            metadata: trip.metadata,
          }
          const done = {
            select() { return done },
            single: async () => ({ data: selected, error: null }),
            then(resolve) { resolve({ data: selected, error: null }) },
          }
          return done
        }
        const done = {
          select() { return done },
          single: async () => ({ data: { id: 'row' }, error: null }),
          then(resolve) { resolve({ data: null, error: null }) },
        }
        return done
      },
      update(payload) {
        if (table === 'credit_accounts' || table === 'credit_ledger' || table === 'profiles') {
          state.creditWrites.push({ table, op: 'update', payload })
        }
        const done = {
          eq() { return done },
          then(resolve) { resolve({ data: null, error: null }) },
        }
        return done
      },
      then(resolve) {
        if (table === 'driver_applications') {
          resolve({ data: [{ profile_id: 'driver-1', onboarding_status: 'approved' }], error: null })
          return
        }
        if (table === 'driver_status') {
          resolve({ data: [{ driver_id: 'driver-1', online: true }], error: null })
          return
        }
        if (table === 'vehicles') {
          resolve({
            data: [{ driver_id: 'driver-1', service_class: 'comfort', tier: 'comfort' }],
            error: null,
          })
          return
        }
        resolve({ data: [], error: null })
      },
    }
    return api
  }
  return { state, from: (table) => chain(table) }
}

function rider(email) {
  return {
    id: 'rider-1',
    email,
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    user_metadata: { full_name: 'Alex Rider' },
  }
}

const depsFor = (sb, user) => ({
  sb,
  user,
  ensureProfile: async () => ({ ok: true }),
  computeRoutes: async () => ({ error: 'skip' }),
  now: new Date('2026-10-04T18:00:00.000Z'),
})

const campus = {
  pickupLabel: 'Memorial Stadium',
  pickupLat: 34.6788,
  pickupLng: -82.843,
  dest: 'Tillman Hall',
  destLat: 34.6832,
  destLng: -82.8374,
}

test('a missing credit account starts at zero and does not grant a balance', async () => {
  const empty = createSb({ balanceMode: 'empty' })
  const none = await readRideCreditBalance(empty, 'rider-1')
  assert.equal(none.known, true)
  assert.equal(none.balanceCents, 0)

  const missing = createSb({ balanceMode: 'missing-table' })
  const absent = await readRideCreditBalance(missing, 'rider-1')
  assert.equal(absent.known, false)
  assert.equal(absent.balanceCents, 0)

  const failed = createSb({ balanceMode: 'error' })
  const unknown = await readRideCreditBalance(failed, 'rider-1')
  assert.equal(unknown.known, false)
  assert.equal(unknown.balanceCents, 0)
  assert.equal(creditsCoverFare(unknown.balanceCents, 1000), false)
})

test('credits can be selected only when the server balance covers the server fare', () => {
  const campusOffer = billingOffer({ fareCents: 1800, depositCents: 0, balanceCents: 1800, balanceKnown: true })
  assert.equal(campusOffer.campus, true)
  assert.equal(campusOffer.creditsSelectable, true)
  assert.equal(campusOffer.options.find((row) => row.id === 'no_card').enabled, true)

  const short = resolveBillingChoice({
    choice: 'credits',
    fareCents: 1800,
    depositCents: 0,
    balanceCents: 1799,
    balanceKnown: true,
  })
  assert.equal(short.ok, false)
  assert.equal(short.code, 'credits_insufficient')

  const exact = resolveBillingChoice({
    choice: 'credits',
    fareCents: 1800,
    depositCents: 0,
    balanceCents: 1800,
    balanceKnown: true,
  })
  assert.equal(exact.ok, true)
  assert.equal(exact.choice, 'credits')

  const unknown = resolveBillingChoice({
    choice: 'credits',
    fareCents: 1800,
    depositCents: 0,
    balanceCents: 5000,
    balanceKnown: false,
  })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.code, 'credits_unavailable')

  const airport = billingOffer({
    fareCents: 6400,
    depositCents: cardDepositCents(6400),
    balanceCents: 0,
    balanceKnown: true,
    airport: 'GSP',
  })
  assert.equal(airport.campus, false)
  assert.equal(airport.depositCents, Math.round(6400 * 0.25))
  assert.equal(airport.creditsSelectable, false)
  assert.equal(airport.options.some((row) => row.id === 'no_card'), false)
})

test('airport checkout quotes a 25% deposit and ignores client money', async () => {
  const sb = createSb({ balance: 0 })
  const low = await call(handleBilling, {
    mode: 'quote',
    airport: 'GSP',
    ...SPOOF,
  }, depsFor(sb, rider('fan@gmail.com')))
  const high = await call(handleBilling, {
    mode: 'quote',
    airport: 'GSP',
    fareCents: 999999,
    depositCents: 0,
    amount: 0,
    total: 0,
    isStudent: false,
  }, depsFor(sb, rider('fan@gmail.com')))

  assert.equal(low.status, 200)
  assert.equal(high.status, 200)
  assert.equal(low.json.fareCents, high.json.fareCents)
  assert.equal(low.json.depositCents, cardDepositCents(low.json.fareCents))
  assert.equal(low.json.depositCents, Math.round(low.json.fareCents * 0.25))
  assert.equal(low.json.campus, false)
  assert.equal(low.json.creditsSelectable, false)
  assert.equal(low.json.balanceCents, 0)
  assert.equal(low.json.charged, false)
  assert.equal(low.json.debitedCents, 0)
  assert.equal(sb.state.trips.length, 0)
  assert.equal(sb.state.creditWrites.length, 0)

  const student = await call(handleBilling, {
    mode: 'quote',
    airport: 'GSP',
    isStudent: false,
  }, depsFor(sb, rider('tiger@clemson.edu')))
  assert.equal(student.status, 200)
  assert.ok(student.json.fareCents < low.json.fareCents)
  assert.equal(student.json.depositCents, cardDepositCents(student.json.fareCents))
})

test('selecting credits records the choice and does not debit or charge', async () => {
  const quoted = await call(handleBilling, { mode: 'quote', airport: 'GSP' }, depsFor(createSb({ balance: 0 }), rider('fan@gmail.com')))
  const fare = quoted.json.fareCents
  const sb = createSb({ balance: fare })
  const saved = await call(handleBilling, {
    mode: 'record',
    airport: 'GSP',
    billingChoice: 'credits',
    ...SPOOF,
  }, depsFor(sb, rider('fan@gmail.com')))

  assert.equal(saved.status, 200)
  assert.equal(saved.json.choice, 'credits')
  assert.equal(saved.json.charged, false)
  assert.equal(saved.json.debitedCents, 0)
  assert.equal(saved.json.fareCents, fare)
  assert.equal(sb.state.balance, fare)
  assert.equal(sb.state.creditWrites.length, 0)
  assert.equal(sb.state.trips.length, 1)
  const trip = sb.state.trips[0]
  assert.equal(trip.metadata.billing_choice, 'credits')
  assert.equal(trip.metadata.billing_debited_cents, 0)
  assert.equal(trip.metadata.billing_charged, false)
  assert.equal(trip.fare_cents, fare)
  assert.equal(trip.deposit_cents, cardDepositCents(fare))
  assert.equal(sb.state.balance, fare)

  const short = createSb({ balance: fare - 1 })
  const denied = await call(handleBilling, {
    mode: 'record',
    airport: 'GSP',
    billingChoice: 'credits',
  }, depsFor(short, rider('fan@gmail.com')))
  assert.equal(denied.status, 409)
  assert.equal(denied.json.code, 'credits_insufficient')
  assert.equal(short.state.trips.length, 0)
  assert.equal(short.state.balance, fare - 1)
  assert.equal(short.state.creditWrites.length, 0)
})

test('campus rides still complete with no card, and airport pick-a-driver does not open a charge', async () => {
  const sb = createSb({ balance: 0 })
  const campusRide = await call(requestDriverTrip, {
    driverId: 'driver-1',
    ...campus,
    billingChoice: 'no_card',
    ...SPOOF,
  }, depsFor(sb, rider('fan@gmail.com')))
  assert.equal(campusRide.status, 200)
  assert.equal(campusRide.json.trip.deposit_cents, 0)
  assert.equal(sb.state.trips[0].metadata.billing_choice, 'no_card')
  assert.equal(sb.state.trips[0].metadata.billing_charged, false)
  assert.equal(sb.state.creditWrites.length, 0)

  const bare = createSb({ balance: 0 })
  const untouched = await call(requestDriverTrip, {
    driverId: 'driver-1',
    ...campus,
  }, depsFor(bare, rider('fan@gmail.com')))
  assert.equal(untouched.status, 200)
  assert.equal(untouched.json.trip.deposit_cents, 0)
  assert.equal(bare.state.trips[0].metadata.billing_choice, undefined)

  const airport = createSb({ balance: 100000 })
  const held = await call(requestDriverTrip, {
    driverId: 'driver-1',
    dest: 'GSP Airport',
    billingChoice: 'credits',
    ...SPOOF,
  }, depsFor(airport, rider('fan@gmail.com')))
  assert.equal(held.status, 409)
  assert.equal(held.json.code, 'airport_deposit_required')
  assert.equal(airport.state.trips.length, 0)
  assert.equal(airport.state.balance, 100000)
  assert.equal(airport.state.creditWrites.length, 0)
})

test('scheduling records credits or the 25% deposit request without spending the balance', async () => {
  const preview = await call(handleBilling, {
    mode: 'quote',
    ...campus,
    date: '2026-10-02',
    time: '15:00',
  }, depsFor(createSb({ balance: 0 }), rider('fan@gmail.com')))
  const fare = preview.json.fareCents
  assert.equal(preview.json.campus, true)
  assert.equal(preview.json.depositCents, 0)

  const sb = createSb({ balance: fare })
  const saved = await call(scheduleTrip, {
    ...campus,
    pickup: { label: campus.pickupLabel, lat: campus.pickupLat, lng: campus.pickupLng },
    dropoff: { label: campus.dest, lat: campus.destLat, lng: campus.destLng },
    date: '2026-10-02',
    time: '15:00',
    billingChoice: 'credits',
    ...SPOOF,
  }, {
    ...depsFor(sb, rider('fan@gmail.com')),
    now: new Date('2026-09-21T16:00:00.000Z').getTime(),
  })
  assert.equal(saved.status, 200, JSON.stringify(saved.json))
  assert.equal(sb.state.trips.length, 1)
  assert.equal(sb.state.trips[0].metadata.billing_choice, 'credits')
  assert.equal(sb.state.trips[0].metadata.billing_debited_cents, 0)
  assert.equal(sb.state.trips[0].metadata.schedule_discount_pct, 10)
  assert.equal(sb.state.trips[0].fare_cents, fare - Math.round(fare * 0.1))
  assert.equal(sb.state.balance, fare)
  assert.equal(sb.state.creditWrites.length, 0)

  const airport = createSb({ balance: 0 })
  const deposit = await call(scheduleTrip, {
    airport: 'GSP',
    date: '2026-10-02',
    time: '15:00',
    billingChoice: 'deposit',
    ...SPOOF,
  }, {
    ...depsFor(airport, rider('fan@gmail.com')),
    now: new Date('2026-09-21T16:00:00.000Z').getTime(),
  })
  assert.equal(deposit.status, 200, JSON.stringify(deposit.json))
  assert.equal(airport.state.trips[0].metadata.billing_choice, 'deposit')
  assert.equal(airport.state.trips[0].deposit_cents, cardDepositCents(airport.state.trips[0].fare_cents))
  assert.equal(airport.state.trips[0].metadata.billing_charged, false)
  assert.equal(airport.state.creditWrites.length, 0)
})

test('the billing handler does not call Stripe or write a credit debit', () => {
  const src = readFileSync(new URL('./endpoints/rideBilling.js', import.meta.url), 'utf8')
  const lib = readFileSync(new URL('./rideBilling.js', import.meta.url), 'utf8')
  const sql = readFileSync(new URL('../supabase/migrations/20261004210000_ride_credits_ledger.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /paymentIntents|debitLots\(|applyCredits\(|stripeClient|stripe\.checkout/)
  assert.doesNotMatch(lib, /paymentIntents|debitLots\(|applyCredits\(|stripeClient|stripe\.checkout/)
  assert.doesNotMatch(src, /body\.fareCents|body\.depositCents|body\.amount|body\.total|body\.isStudent/)
  assert.match(src, /CLIENT_MONEY_KEYS/)
  assert.doesNotMatch(src, /credit_ledger/)
  assert.doesNotMatch(lib, /credit_ledger/)
  assert.doesNotMatch(lib, /credit_balance_cents/)
  assert.match(lib, /from\('credit_accounts'\)\.select\('balance_cents'\)/)
  assert.match(sql, /credit_ledger already exists/)
  assert.equal(sql.replace(/--[^\n]*/g, '').trim(), '')
})
