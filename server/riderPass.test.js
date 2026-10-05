import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import requestDriverTrip from './endpoints/requestDriverTrip.js'
import handleTigerPass from './endpoints/tigerPass.js'
import handleFavoriteDrivers from './endpoints/favoriteDrivers.js'
import { TIGER_PASS_NAME } from '../shared/tigerPass.js'
import { percentOffCents } from '../src/lib/fareRates.js'
import { priceDriverRequest } from './authoritativeFare.js'

const JOHN = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const RIDER = '33333333-3333-4333-8333-333333333333'
const NOW = new Date('2026-10-05T12:00:00.000Z')

function memorySb(seed = {}) {
  const tables = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }))
  function rowsOf(table) {
    if (!tables[table]) tables[table] = []
    return tables[table]
  }
  function from(table) {
    const state = { filters: [], op: 'select', payload: null }
    const api = {
      select() { return api },
      eq(col, val) { state.filters.push({ col, val, kind: 'eq' }); return api },
      in(col, val) { state.filters.push({ col, val, kind: 'in' }); return api },
      lte() { return api },
      gte() { return api },
      gt() { return api },
      order() { return api },
      limit() { return api },
      is() { return api },
      not() { return api },
      match(row) {
        return state.filters.every((filter) => (
          filter.kind === 'in' ? filter.val.includes(row[filter.col]) : row[filter.col] === filter.val
        ))
      },
      insert(payload) { state.op = 'insert'; state.payload = payload; return api },
      update(payload) { state.op = 'update'; state.payload = payload; return api },
      upsert(payload) { state.op = 'upsert'; state.payload = payload; return api },
      async maybeSingle() {
        if (state.op === 'upsert') {
          const key = state.payload.rider_id
          const existing = rowsOf(table).find((row) => row.rider_id === key)
          if (existing) Object.assign(existing, state.payload)
          else rowsOf(table).push({ ...state.payload })
          return { data: rowsOf(table).find((row) => row.rider_id === key), error: null }
        }
        const found = rowsOf(table).filter((row) => api.match(row))
        return { data: found[0] || null, error: null }
      },
      async single() {
        if (state.op === 'insert') {
          const row = { id: state.payload.id || `${table}-${rowsOf(table).length + 1}`, ...state.payload }
          rowsOf(table).push(row)
          return { data: row, error: null }
        }
        const found = rowsOf(table).filter((row) => api.match(row))
        return { data: found[0] || null, error: found[0] ? null : { message: 'missing' } }
      },
      then(resolve) {
        if (state.op === 'update') {
          const found = rowsOf(table).filter((row) => api.match(row))
          found.forEach((row) => Object.assign(row, state.payload))
          resolve({ data: found, error: null })
          return
        }
        if (state.op === 'insert') {
          const row = { id: state.payload.id || `${table}-${rowsOf(table).length + 1}`, ...state.payload }
          rowsOf(table).push(row)
          resolve({ data: row, error: null })
          return
        }
        resolve({ data: rowsOf(table).filter((row) => api.match(row)), error: null })
      },
    }
    return api
  }
  return { sb: { from }, tables }
}

function mockRes() {
  return {
    statusCode: 200,
    body: '',
    setHeader() {},
    end(payload) { this.body = payload == null ? '' : String(payload) },
  }
}

async function call(handler, body, deps) {
  const res = mockRes()
  await handler({ method: 'POST', headers: {}, body }, res, deps)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

const REQUEST_BODY = {
  pickupLabel: 'Clemson Campus',
  pickupLat: 34.6788,
  pickupLng: -82.843,
  dropoffLabel: 'Downtown',
  destLat: 34.68,
  destLng: -82.83,
  autoAssign: true,
}

function riderUser() {
  return { id: RIDER, email: 'rider@example.com', user_metadata: { full_name: 'Ava' } }
}

function fleet(extraProfiles = []) {
  return memorySb({
    driver_status: [
      { driver_id: JOHN, online: true },
      { driver_id: OTHER, online: true },
    ],
    driver_applications: [
      { profile_id: JOHN, onboarding_status: 'approved' },
      { profile_id: OTHER, onboarding_status: 'approved' },
    ],
    profiles: [
      { id: JOHN, email: 'johnmatveyev@gmail.com' },
      { id: OTHER, email: 'someone@example.com' },
      { id: RIDER, email: 'rider@example.com', favorite_driver_ids: ['demo-marcus', OTHER, JOHN] },
      ...extraProfiles,
    ],
  })
}

test('auto-assign offers an active pass preferred driver before other favorites and drops preview cars', async () => {
  const active = fleet()
  active.tables.rider_subscriptions = [{
    rider_id: RIDER,
    status: 'active',
    discount_bps: 1000,
    preferred_driver_ids: ['demo-marcus', OTHER],
    preferred_car_types: ['comfort'],
    current_period_end: '2026-11-01T00:00:00.000Z',
  }]
  const res = await call(requestDriverTrip, REQUEST_BODY, {
    sb: active.sb,
    user: riderUser(),
    ensureProfile: async () => ({ ok: true }),
    now: NOW,
  })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json.trip ? active.tables.trips[0].metadata.auto_assign_queue : null, [OTHER, JOHN])
  assert.equal(active.tables.trips[0].metadata.offer_preference, 'tiger_pass')
  assert.equal(active.tables.trips[0].metadata.auto_assign_queue.includes('demo-marcus'), false)
  assert.equal(active.tables.trips[0].metadata.tiger_pass_discount_bps, 1000)
  assert.ok(active.tables.trips[0].metadata.tiger_pass_discount_cents > 0)

  const plain = fleet()
  const open = await call(requestDriverTrip, REQUEST_BODY, {
    sb: plain.sb,
    user: riderUser(),
    ensureProfile: async () => ({ ok: true }),
  })
  assert.equal(open.status, 200)
  assert.deepEqual(plain.tables.trips[0].metadata.auto_assign_queue, [JOHN, OTHER])
  assert.equal(plain.tables.trips[0].metadata.offer_preference, 'favorite')
  const places = {
    pickup: { label: 'Clemson Campus', lat: 34.6788, lng: -82.843 },
    dropoff: { label: 'Downtown', lat: 34.68, lng: -82.83 },
    airport: null,
  }
  const full = priceDriverRequest(places, { isStudent: false, tier: 'standard' })
  assert.equal(active.tables.trips[0].fare_cents, percentOffCents(full.fareCents, 1000).amountCents)
  assert.equal(plain.tables.trips[0].fare_cents, full.fareCents)
})

test('pass preferences reject retired ride types and favorite saves drop preview cars', async () => {
  const store = memorySb({
    profiles: [{ id: RIDER, favorite_driver_ids: [] }],
    rider_subscriptions: [{
      rider_id: RIDER,
      status: 'inactive',
      preferred_driver_ids: [OTHER],
      preferred_car_types: [],
    }],
  })
  const blocked = ['robo', 'taxi'].join('')
  const rejected = await call(handleTigerPass, {
    op: 'preferences',
    preferredCarTypes: [blocked],
    preferredDriverIds: [OTHER],
  }, { sb: store.sb, user: riderUser(), ensureProfile: async () => ({ ok: true }), now: NOW })
  assert.equal(rejected.status, 400)
  assert.equal(rejected.json.code, 'ride_option_unavailable')

  const saved = await call(handleFavoriteDrivers, {
    op: 'set',
    driverIds: ['demo-marcus', 'sim-busy-2', OTHER, OTHER],
  }, { sb: store.sb, user: riderUser(), ensureProfile: async () => ({ ok: true }), now: NOW })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.json.favoriteDriverIds, [OTHER])
  assert.equal(saved.json.demoDriversIgnored, true)
  assert.deepEqual(store.tables.profiles[0].favorite_driver_ids, [OTHER])
  assert.deepEqual(store.tables.rider_subscriptions[0].preferred_driver_ids, [OTHER])
})

test('checkout uses the rename hook and confirm activates the pass', async () => {
  const store = memorySb({ profiles: [{ id: RIDER, email: 'rider@example.com' }] })
  let created = null
  const stripe = {
    checkout: {
      sessions: {
        async create(payload) {
          created = payload
          return { id: 'cs_pass', url: 'https://checkout.test/pass' }
        },
        async retrieve() {
          return {
            id: 'cs_pass',
            payment_status: 'paid',
            customer: 'cus_1',
            subscription: 'sub_1',
            metadata: { kind: 'tiger_pass', profile_id: RIDER },
          }
        },
      },
    },
    subscriptions: {
      async retrieve() {
        return { current_period_end: Math.floor(new Date('2026-11-04T00:00:00Z').getTime() / 1000) }
      },
    },
  }
  const checkout = await call(handleTigerPass, { op: 'checkout', origin: 'https://clemsonrides.test' }, {
    sb: store.sb,
    user: riderUser(),
    stripe,
    ensureProfile: async () => ({ ok: true }),
    now: NOW,
  })
  assert.equal(checkout.status, 200)
  assert.equal(checkout.json.name, TIGER_PASS_NAME)
  assert.equal(created.mode, 'subscription')
  assert.equal(created.line_items[0].price_data.product_data.name, TIGER_PASS_NAME)
  assert.equal(created.metadata.kind, 'tiger_pass')

  const confirmed = await call(handleTigerPass, { op: 'confirm', sessionId: 'cs_pass' }, {
    sb: store.sb,
    user: riderUser(),
    stripe,
    ensureProfile: async () => ({ ok: true }),
    now: NOW,
  })
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.json.active, true)
  assert.equal(confirmed.json.name, TIGER_PASS_NAME)
  assert.equal(store.tables.rider_subscriptions[0].status, 'active')
})

test('request pricing does not trust a client pass flag', () => {
  const source = readFileSync(new URL('./endpoints/requestDriverTrip.js', import.meta.url), 'utf8')
  const quote = readFileSync(new URL('./endpoints/quoteFare.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /body\.tigerPass/)
  assert.match(source, /loadRiderMatchPreferences/)
  assert.match(quote, /loadRiderMatchPreferences/)
  assert.match(readFileSync(new URL('../api/stripe-webhook.js', import.meta.url), 'utf8'), /kind === 'tiger_pass'/)
})
