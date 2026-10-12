import assert from 'node:assert/strict'
import test from 'node:test'
import handler, { packetFromInputs, yearFromRequest } from './endpoints/driverTaxSummary.js'
import { STRIPE_CONNECT_1099_URL, TAX_NOT_ADVICE } from '../shared/driverTaxMileage.js'

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    end(payload) { this.body = payload == null ? '' : String(payload) },
  }
}

async function call(req, deps) {
  const res = mockRes()
  await handler(req, res, deps)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

test('tax summary rejects the wrong method, a missing sign-in, and a bad year', async () => {
  assert.equal((await call({ method: 'POST', url: '/api/driver?action=tax-summary' }, { sb: {}, user: { id: 'd' } })).status, 405)
  assert.equal((await call({ method: 'GET', url: '/api/driver?action=tax-summary' }, { sb: null })).status, 503)
  assert.equal((await call({ method: 'GET', url: '/api/driver?action=tax-summary' }, { sb: {}, user: null })).status, 401)
  assert.equal((await call({ method: 'GET', url: '/api/driver?action=tax-summary&year=1999' }, { sb: {}, user: { id: 'd' }, loadTaxInputs: async () => ({}) })).status, 400)
  assert.equal(yearFromRequest({ url: '/api/driver?action=tax-summary&year=2026' }), 2026)
  assert.equal(yearFromRequest({ url: '/api/driver?action=tax-summary' }), null)
})

test('tax summary is the signed-in driver only, with split miles and an estimated deduction', async () => {
  const secretLat = 34.683437
  const written = []
  const filters = []
  function chain(table) {
    const api = {
      select() { return api },
      eq(column, value) { filters.push([table, column, value]); return api },
      in() { return api },
      order() { return api },
      limit() { return api },
      upsert(rows) { written.push(rows); return Promise.resolve({ error: null }) },
      then(resolve, reject) { return Promise.resolve(rowsFor(table)).then(resolve, reject) },
    }
    return api
  }
  function rowsFor(table) {
    if (table === 'trips') {
      return {
        data: [{
          id: 'trip-1',
          driver_id: 'driver-1',
          rider_id: 'rider-1',
          status: 'completed',
          fare_cents: 10000,
          tip_cents: 250,
          pickup_label: '123 Main Street, Clemson, SC',
          dropoff_label: 'Memorial Stadium',
          pickup_lat: secretLat,
          pickup_lng: -82.8374,
          dropoff_lat: 34.6788,
          dropoff_lng: -82.843,
          completed_at: '2026-05-02T15:00:00Z',
          metadata: { route_distance_m: 1609.344, payout: { status: 'paid', amountCents: 6400 } },
        }],
        error: null,
      }
    }
    if (table === 'driver_mileage_logs') {
      return {
        data: [{
          trip_id: 'trip-1',
          on_trip_source: 'unavailable',
          enroute_miles: 0.4,
          enroute_source: 'straight_line',
        }],
        error: null,
      }
    }
    if (table === 'driver_payouts') {
      return { data: [{ trip_id: 'trip-1', driver_id: 'driver-1', amount_cents: 6400, status: 'paid' }], error: null }
    }
    return { data: [], error: null }
  }
  const sb = { from: (table) => chain(table) }
  const res = await call(
    { method: 'GET', url: '/api/driver?action=tax-summary&year=2026' },
    { sb, user: { id: 'driver-1' } },
  )
  assert.equal(res.status, 200)
  assert.equal(res.json.grossEarningsCents, 10250)
  assert.equal(res.json.tipsCents, 250)
  assert.equal(res.json.platformFeeCents, 2050)
  assert.equal(res.json.payoutsCents, 6400)
  assert.equal(res.json.onTripMiles, 1)
  assert.equal(res.json.enrouteMiles, 0.4)
  assert.equal(res.json.deductibleMiles, 1.4)
  assert.equal(res.json.estimate, true)
  assert.equal(res.json.trips[0].rateCentsPerMile, 72.5)
  assert.equal(res.json.disclaimer, TAX_NOT_ADVICE)
  assert.equal(res.json.stripe1099Url, STRIPE_CONNECT_1099_URL)
  assert.equal(res.json.trips[0].pickupLabel.includes('Main Street'), false)
  const body = JSON.stringify(res.json)
  assert.equal(body.includes(String(secretLat)), false)
  assert.equal(body.includes('Main Street'), false)
  assert.ok(filters.some((entry) => entry[0] === 'trips' && entry[1] === 'driver_id' && entry[2] === 'driver-1'))
  assert.ok(filters.some((entry) => entry[0] === 'driver_mileage_logs' && entry[2] === 'driver-1'))
  assert.equal(written[0][0].driver_id, 'driver-1')
  assert.equal(written[0][0].enroute_source, 'straight_line')
  assert.equal(written[0][0].on_trip_source, 'routed')
})

test('packet builder does not keep another driver payout row', () => {
  const packet = packetFromInputs({
    year: 2026,
    now: new Date('2026-06-01T00:00:00Z'),
    trips: [{
      id: 'mine',
      driver_id: 'driver-1',
      status: 'completed',
      fare_cents: 5000,
      completed_at: '2026-04-01T15:00:00Z',
      pickup_label: 'Campus',
      dropoff_label: 'Downtown',
      metadata: { distance_m: 1609.344 },
    }],
    payouts: [
      { trip_id: 'mine', driver_id: 'driver-1', amount_cents: 4000, status: 'paid' },
      { trip_id: 'other', driver_id: 'driver-2', amount_cents: 9999, status: 'paid' },
    ],
  })
  assert.equal(packet.payoutsCents, 4000)
  assert.equal(packet.trips.length, 1)
  assert.equal(packet.trips[0].id, 'mine')
})
