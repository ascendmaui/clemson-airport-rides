/** request-driver with a promo code: no stacking, list fare kept for driver pay. */
import assert from 'node:assert/strict'
import test from 'node:test'
import requestDriverTrip from './endpoints/requestDriverTrip.js'
import { priceDriverRequest } from './authoritativeFare.js'
import { promoTripSnapshot } from '../shared/promoCodes.js'

const JOHN = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const RIDER = '33333333-3333-4333-8333-333333333333'
const TRIP_ID = '44444444-4444-4444-8444-444444444444'
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
      { id: RIDER, email: 'rider@example.com', stripe_default_pm_id: 'pm_test', favorite_driver_ids: ['demo-marcus', OTHER, JOHN] },
      ...extraProfiles,
    ],
  })
}


function withPass(state) {
  state.tables.rider_subscriptions = [{
    rider_id: RIDER, status: 'active', discount_bps: 1000, preferred_driver_ids: [], preferred_car_types: [],
    current_period_end: '2026-11-01T00:00:00.000Z',
  }]
  return state
}

const PLACES = {
  pickup: { label: 'Clemson Campus', lat: 34.6788, lng: -82.843 },
  dropoff: { label: 'Downtown', lat: 34.68, lng: -82.83 },
  airport: null,
}

test('a winning code books at the list fare (driver pay basis) with the promo snapshot', async () => {
  const state = withPass(fleet())
  const seen = []
  const res = await call(requestDriverTrip, { ...REQUEST_BODY, promoCode: 'fall20', deviceId: 'dev-0123456789abcdef' }, {
    sb: state.sb,
    user: riderUser(),
    ensureProfile: async () => ({ ok: true }),
    now: NOW,
    applyPromo: async (args) => {
      seen.push(args)
      const snapshot = promoTripSnapshot({
        ok: true, redemption_id: 'red_1', code: 'FALL20', discount_type: 'flat', amount_off_cents: 500, discount_cents: 500,
      }, { listFareCents: args.list.fareCents, recurringFareCents: args.recurring.fareCents })
      return { tripId: TRIP_ID, priced: args.list, snapshot, promo: { applied: true, code: 'FALL20', discountCents: 500 } }
    },
  })
  assert.equal(res.status, 200)
  const list = priceDriverRequest(PLACES, { isStudent: false, tier: 'standard' })
  assert.equal(seen[0].code, 'fall20')
  assert.equal(seen[0].deviceId, 'dev-0123456789abcdef')
  assert.equal(seen[0].list.fareCents, list.fareCents)
  assert.ok(seen[0].recurring.fareCents < list.fareCents, 'Tiger Pass price is the recurring option')
  const trip = state.tables.trips[0]
  assert.equal(trip.id, TRIP_ID, 'the reservation and the trip share one id')
  assert.equal(trip.fare_cents, list.fareCents)
  assert.equal(trip.metadata.promo.redemption_id, 'red_1')
  assert.equal(trip.metadata.promo.funded_by, 'platform')
  assert.equal(trip.fare_breakdown.rider_pays_cents, list.fareCents - 500)
  assert.equal(trip.metadata.tiger_pass_discount_cents || 0, 0, 'no stacking with Tiger Pass')
  assert.equal(res.json.promo.applied, true)
})

test('when the code loses, the Tiger Pass price stands and no snapshot is stored', async () => {
  const state = withPass(fleet())
  const res = await call(requestDriverTrip, { ...REQUEST_BODY, promoCode: 'small1' }, {
    sb: state.sb,
    user: riderUser(),
    ensureProfile: async () => ({ ok: true }),
    now: NOW,
    applyPromo: async ({ recurring }) => ({
      tripId: TRIP_ID, priced: recurring, snapshot: null,
      promo: { applied: false, code: 'SMALL1', reason: 'better_discount_applied' },
    }),
  })
  assert.equal(res.status, 200)
  const trip = state.tables.trips[0]
  assert.notEqual(trip.id, TRIP_ID)
  assert.equal(trip.metadata.promo, undefined)
  assert.ok(trip.metadata.tiger_pass_discount_cents > 0)
  assert.equal(res.json.promo.reason, 'better_discount_applied')
})
