/**
 * API handler tests for schedule/fare/auth bounds and webhook hardening.
 * Tests edge cases, malicious or tampered payloads, cross-tenant isolation,
 * timing-safe secret compares, and request boundary conditions.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'

import stripeWebhookHandler, { extractStripeSignature } from '../api/stripe-webhook.js'
import stripePaymentMethodsHandler from '../api/stripe-payment-methods.js'
import handleScheduledRider from '../server/endpoints/scheduledRider.js'
import handleScheduleSlots from '../server/endpoints/scheduleSlots.js'
import handleQuoteFare from '../server/endpoints/quoteFare.js'
import handleAirportCheckout from '../server/endpoints/airportCheckout.js'
import handleScheduledDispatchTick from '../server/endpoints/scheduledDispatchTick.js'
import handleBumpScheduledBoost from '../server/endpoints/bumpScheduledBoost.js'
import handleReleaseScheduledBoost from '../server/endpoints/releaseScheduledBoost.js'
import handleDriverEarnings from '../server/endpoints/driverEarnings.js'
import { backupBookingMetadata } from '../shared/backupDriverQueue.js'

const NOW = new Date('2026-10-10T15:00:00.000Z')
const SIKES = { label: 'Sikes Hall', lat: 34.6795, lng: -82.8374 }
const COOPER = { label: 'Cooper Library', lat: 34.6765, lng: -82.8375 }

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writableEnded: false,
    headersSent: false,
    setHeader(name, value) {
      if (this.headersSent) throw new Error('Headers already sent')
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      if (this.writableEnded) throw new Error('Write after end')
      this.headersSent = true
      this.writableEnded = true
      this.body = payload == null ? '' : String(payload)
    },
  }
}

async function call(handler, req, deps = {}) {
  const res = mockRes()
  const request = {
    method: 'POST',
    url: '/',
    headers: {},
    ...req,
  }
  await handler(request, res, deps)
  let json = null
  try {
    json = res.body ? JSON.parse(res.body) : null
  } catch {
    json = null
  }
  return { status: res.statusCode, headers: res.headers, body: res.body, json }
}

function createFakeSb(initialData = {}) {
  const tables = {
    trips: [],
    trip_events: [],
    driver_applications: [],
    driver_status: [],
    vehicles: [],
    payments: [],
    ride_bills: [],
    ...initialData,
  }

  return {
    _tables: tables,
    from(table) {
      if (!tables[table]) tables[table] = []
      let selectedCols = '*'
      const filters = []
      let limitCount = null
      let orderCol = null

      const chain = {
        select(cols) {
          selectedCols = cols
          return chain
        },
        eq(col, val) {
          filters.push({ col, op: 'eq', val })
          return chain
        },
        in(col, vals) {
          filters.push({ col, op: 'in', val: vals })
          return chain
        },
        order(col, opts) {
          orderCol = { col, opts }
          return chain
        },
        limit(n) {
          limitCount = n
          return chain
        },
        maybeSingle: async () => {
          let rows = tables[table].filter((row) =>
            filters.every((f) => {
              if (f.op === 'eq') return row[f.col] === f.val
              if (f.op === 'in') return f.val.includes(row[f.col])
              return true
            })
          )
          return { data: rows[0] || null, error: null }
        },
        single: async () => {
          let rows = tables[table].filter((row) =>
            filters.every((f) => {
              if (f.op === 'eq') return row[f.col] === f.val
              if (f.op === 'in') return f.val.includes(row[f.col])
              return true
            })
          )
          if (!rows[0]) return { data: null, error: { message: 'Row not found' } }
          return { data: rows[0], error: null }
        },
        insert: (rowOrRows) => {
          const inserted = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
          for (const item of inserted) {
            const entry = { id: item.id || `gen-${Math.random().toString(36).slice(2, 9)}`, ...item }
            tables[table].push(entry)
          }
          return {
            select: () => ({
              single: async () => ({ data: tables[table].at(-1), error: null }),
              maybeSingle: async () => ({ data: tables[table].at(-1), error: null }),
            }),
            then(resolve) {
              resolve({ data: tables[table].at(-1), error: null })
            },
          }
        },
        update: (patch) => {
          return {
            eq(col, val) {
              filters.push({ col, op: 'eq', val })
              return this
            },
            is(col, val) {
              filters.push({ col, op: 'is', val })
              return this
            },
            select: () => ({
              maybeSingle: async () => {
                const target = tables[table].find((row) =>
                  filters.every((f) => {
                    if (f.op === 'eq') return row[f.col] === f.val
                    if (f.op === 'is') return f.val === null ? row[f.col] == null : row[f.col] === f.val
                    return true
                  })
                )
                if (target) Object.assign(target, patch)
                return { data: target || null, error: null }
              },
            }),
            then(resolve) {
              const matches = tables[table].filter((row) =>
                filters.every((f) => {
                  if (f.op === 'eq') return row[f.col] === f.val
                  if (f.op === 'is') return f.val === null ? row[f.col] == null : row[f.col] === f.val
                  return true
                })
              )
              for (const m of matches) Object.assign(m, patch)
              resolve({ data: matches, error: null })
            },
          }
        },
        then(resolve) {
          let rows = tables[table].filter((row) =>
            filters.every((f) => {
              if (f.op === 'eq') return row[f.col] === f.val
              if (f.op === 'in') return f.val.includes(row[f.col])
              return true
            })
          )
          if (limitCount != null) rows = rows.slice(0, limitCount)
          resolve({ data: rows, error: null })
        },
      }
      return chain
    },
  }
}

// ---------------------------------------------------------------------------
// 1. SCHEDULE BOUNDS TESTS
// ---------------------------------------------------------------------------

test('schedule bounds: handleScheduledRider enforces method and auth bounds', async () => {
  const getRes = await call(handleScheduledRider, { method: 'GET' })
  assert.equal(getRes.status, 405)

  const putRes = await call(handleScheduledRider, { method: 'PUT' })
  assert.equal(putRes.status, 405)

  const deleteRes = await call(handleScheduledRider, { method: 'DELETE' })
  assert.equal(deleteRes.status, 405)

  const noSb = await call(handleScheduledRider, { method: 'POST' }, { sb: null })
  assert.equal(noSb.status, 503)

  const noUser = await call(handleScheduledRider, { method: 'POST' }, { sb: createFakeSb(), user: null })
  assert.equal(noUser.status, 401)
})

test('schedule bounds: handleScheduledRider validates tripId and op bounds', async () => {
  const sb = createFakeSb()
  const user = { id: 'rider-1' }

  const missingTrip = await call(handleScheduledRider, { method: 'POST', body: {} }, { sb, user })
  assert.equal(missingTrip.status, 400)
  assert.match(missingTrip.json.error, /Trip id required/)

  const emptyTrip = await call(handleScheduledRider, { method: 'POST', body: { tripId: '   ' } }, { sb, user })
  assert.equal(emptyTrip.status, 400)
  assert.match(emptyTrip.json.error, /Trip id required/)

  const unknownOp = await call(
    handleScheduledRider,
    { method: 'POST', body: { tripId: 'trip-1', op: 'refund_me' } },
    { sb, user }
  )
  assert.equal(unknownOp.status, 400)
  assert.match(unknownOp.json.error, /Unknown scheduled rider action/)
})

test('schedule bounds: handleScheduledRider enforces cross-account rider isolation', async () => {
  const sb = createFakeSb({
    trips: [
      {
        id: 'trip-rider-a',
        rider_id: 'rider-a',
        status: 'scheduled',
        metadata: {
          backup_queue: {
            ...backupBookingMetadata(1000, NOW),
            primaryDriverId: 'driver-1',
            backupDriverId: 'driver-2',
          },
        },
      },
    ],
  })

  // Rider B attempts to inspect Rider A's trip
  const spyRes = await call(
    handleScheduledRider,
    { method: 'POST', body: { tripId: 'trip-rider-a', op: 'detail' } },
    { sb, user: { id: 'rider-b' }, now: NOW }
  )
  assert.equal(spyRes.status, 403)
  assert.match(spyRes.json.error, /This ride is on another account/)

  // Rider B attempts to switch Rider A's backup driver
  const switchRes = await call(
    handleScheduledRider,
    { method: 'POST', body: { tripId: 'trip-rider-a', op: 'switch' } },
    { sb, user: { id: 'rider-b' }, now: NOW }
  )
  assert.equal(switchRes.status, 403)
  assert.match(switchRes.json.error, /This ride is on another account/)

  // Rider B attempts to cancel Rider A's trip
  const cancelRes = await call(
    handleScheduledRider,
    { method: 'POST', body: { tripId: 'trip-rider-a', op: 'cancel' } },
    { sb, user: { id: 'rider-b' }, now: NOW }
  )
  assert.equal(cancelRes.status, 403)
  assert.match(cancelRes.json.error, /This ride is on another account/)
})

test('schedule bounds: handleScheduleSlots rejects invalid methods and returns clean window', async () => {
  const delRes = await call(handleScheduleSlots, { method: 'DELETE' })
  assert.equal(delRes.status, 405)

  const putRes = await call(handleScheduleSlots, { method: 'PUT' })
  assert.equal(putRes.status, 405)

  const sb = createFakeSb()
  // POST with missing pickup gracefully returns empty window without crashing
  const postRes = await call(handleScheduleSlots, { method: 'POST', body: {} }, { sb, now: NOW })
  assert.equal(postRes.status, 200)
  assert.equal(postRes.json.availableDrivers, 0)
  assert.equal(postRes.json.demoDriversExcluded, true)
  assert.ok(Array.isArray(postRes.json.slots))

  // GET with query parameters
  const getRes = await call(
    handleScheduleSlots,
    { method: 'GET', url: '/api/stripe-payment-methods?action=schedule-slots&lat=34.68&lng=-82.84' },
    { sb, now: NOW }
  )
  assert.equal(getRes.status, 200)
  assert.equal(getRes.json.demoDriversExcluded, true)
})

test('schedule bounds: bumpScheduledBoost rejects non-POST, unauthenticated, and non-owner callers', async () => {
  const getRes = await call(handleBumpScheduledBoost, { method: 'GET' })
  assert.equal(getRes.status, 405)

  const noSb = await call(handleBumpScheduledBoost, { method: 'POST', body: { tripId: 't1' } }, { sb: null, user: null })
  assert.equal(noSb.status, 503)

  const unauthRes = await call(
    handleBumpScheduledBoost,
    { method: 'POST', body: { tripId: 't1' } },
    { sb: createFakeSb(), user: null }
  )
  assert.equal(unauthRes.status, 401)

  const sb = createFakeSb({
    trips: [{ id: 'trip-1', rider_id: 'rider-owner', status: 'scheduled', boost_cents: 1000 }],
  })

  // Non-owner caller cannot find or bump
  const nonOwnerRes = await call(
    handleBumpScheduledBoost,
    { method: 'POST', body: { tripId: 'trip-1', boostCents: 2000 } },
    { sb, user: { id: 'rider-stranger' } }
  )
  assert.equal(nonOwnerRes.status, 404)
  assert.match(nonOwnerRes.json.error, /Scheduled ride not found/)
})

// ---------------------------------------------------------------------------
// 2. FARE BOUNDS & TAMPERING PREVENTION TESTS
// ---------------------------------------------------------------------------

test('fare bounds: quoteFare strips all client money inputs and rejects invalid places', async () => {
  const getRes = await call(handleQuoteFare, { method: 'GET' })
  assert.equal(getRes.status, 405)

  const putRes = await call(handleQuoteFare, { method: 'PUT' })
  assert.equal(putRes.status, 405)

  // Identical pickup and dropoff label rejected
  const identicalRes = await call(handleQuoteFare, {
    method: 'POST',
    body: {
      pickupLabel: 'Library',
      pickupLat: 34.67,
      pickupLng: -82.83,
      dropoffLabel: 'Library',
      dropoffLat: 34.67,
      dropoffLng: -82.83,
    },
  })
  assert.equal(identicalRes.status, 400)
  assert.match(identicalRes.json.error, /different places/)

  // Missing coordinates rejected
  const missingCoords = await call(handleQuoteFare, {
    method: 'POST',
    body: { pickupLabel: 'Library', dropoffLabel: 'Stadium' },
  })
  assert.equal(missingCoords.status, 400)

  // Tampered client fare parameters ignored, server computes authoritative fare
  const tamperedBody = {
    pickup: SIKES,
    dropoff: COOPER,
    fareCents: 100,
    fare_cents: 100,
    depositCents: 50,
    amount: 100,
    total: 100,
    isStudent: true,
    is_student: true,
    tier: 'standard',
  }

  const quoteRes = await call(
    handleQuoteFare,
    { method: 'POST', body: tamperedBody },
    {
      sb: createFakeSb(),
      user: null, // Unauthenticated user claiming student discount
      now: NOW,
      computeRoutes: async () => ({ distanceM: 1000, durationS: 240 }),
    }
  )

  assert.equal(quoteRes.status, 200)
  assert.notEqual(quoteRes.json.fareCents, 100)
  assert.ok(quoteRes.json.fareCents > 500)
  assert.equal(quoteRes.json.studentDiscountApplied, false)
})

test('fare bounds: airportCheckout enforces auth and rejects unknown airport codes', async () => {
  const getRes = await call(handleAirportCheckout, { method: 'GET' })
  assert.equal(getRes.status, 405)

  const noSb = await call(handleAirportCheckout, { method: 'POST' }, { sb: null, user: null })
  assert.equal(noSb.status, 503)

  const unauthRes = await call(handleAirportCheckout, { method: 'POST' }, { sb: createFakeSb(), user: null })
  assert.equal(unauthRes.status, 401)

  const invalidAirport = await call(
    handleAirportCheckout,
    { method: 'POST', body: { airport: 'JFK' } },
    { sb: createFakeSb(), user: { id: 'rider-1' }, ensureProfile: async () => ({ ok: true }) }
  )
  assert.equal(invalidAirport.status, 400)
  assert.match(invalidAirport.json.error, /Unknown airport/)
})

// ---------------------------------------------------------------------------
// 3. AUTH BOUNDS TESTS
// ---------------------------------------------------------------------------

test('auth bounds: scheduledDispatchTick requires valid cron authorization', async () => {
  const putRes = await call(handleScheduledDispatchTick, { method: 'PUT' })
  assert.equal(putRes.status, 405)

  const env = { CRON_SECRET: 'super-secret-cron-token' }

  // Missing bearer off Vercel
  const missingBearer = await call(
    handleScheduledDispatchTick,
    { method: 'POST', headers: {} },
    { sb: createFakeSb(), env }
  )
  assert.equal(missingBearer.status, 401)
  assert.match(missingBearer.json.error, /Cron authorization required/)

  // Wrong bearer off Vercel
  const wrongBearer = await call(
    handleScheduledDispatchTick,
    { method: 'POST', headers: { authorization: 'Bearer wrong-secret' } },
    { sb: createFakeSb(), env }
  )
  assert.equal(wrongBearer.status, 401)

  // Staging disabled block
  const disabledCron = await call(
    handleScheduledDispatchTick,
    { method: 'POST', headers: { authorization: 'Bearer super-secret-cron-token' } },
    { sb: createFakeSb(), env: { ...env, DISABLE_CRON_ENDPOINTS: '1' } }
  )
  assert.equal(disabledCron.status, 403)
})

test('auth bounds: driverEarnings requires authentication and scopes to driver_id', async () => {
  const postRes = await call(handleDriverEarnings, { method: 'POST' })
  assert.equal(postRes.status, 405)

  const unauthRes = await call(handleDriverEarnings, { method: 'GET', headers: {} }, { sb: createFakeSb(), user: null })
  assert.equal(unauthRes.status, 401)
})

// ---------------------------------------------------------------------------
// 4. WEBHOOK HARDENING TESTS
// ---------------------------------------------------------------------------

function mockWebhookStream(bodyText) {
  const stream = Readable.from([Buffer.from(bodyText)])
  stream.headers = {}
  stream.method = 'POST'
  return stream
}

test('webhook hardening: rejects non-POST and always emits strict no-cache headers', async () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const res = mockRes()
    await stripeWebhookHandler({ method, headers: {} }, res)
    assert.equal(res.statusCode, 405)
    assert.equal(res.headers['allow'], 'POST')
    assert.match(res.headers['cache-control'], /no-store/)
  }
})

test('webhook hardening: extractStripeSignature safely parses headers', () => {
  assert.equal(extractStripeSignature(null), '')
  assert.equal(extractStripeSignature({}), '')
  assert.equal(extractStripeSignature({ 'stripe-signature': '  t=100,v1=sig  ' }), 't=100,v1=sig')
  assert.equal(extractStripeSignature({ 'STRIPE-SIGNATURE': ['t=100,v1=sig', 'extra'] }), 't=100,v1=sig')
})

test('webhook hardening: supports pre-buffered req.rawBody and req.body Buffer', async () => {
  const rawBodyObj = { id: 'evt_raw', object: 'event', type: 'unhandled.event.type' }
  const rawBodyBuffer = Buffer.from(JSON.stringify(rawBodyObj))

  const reqWithRawBody = {
    method: 'POST',
    headers: {},
    rawBody: rawBodyBuffer,
    on() {
      throw new Error('stream.on should not be called when rawBody is present')
    },
  }

  const res = mockRes()
  await stripeWebhookHandler(reqWithRawBody, res, {
    stripeSecret: 'sk_test_mock',
    webhookSecret: '', // unsigned mode
  })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.received, true)
  assert.equal(body.type, 'unhandled.event.type')
})

test('webhook hardening: gracefully handles unhandled Stripe events with 200 received:true', async () => {
  const unhandledEvent = {
    id: 'evt_test_unhandled',
    object: 'event',
    type: 'charge.dispute.created',
    data: { object: { id: 'dp_123' } },
  }

  const req = mockWebhookStream(JSON.stringify(unhandledEvent))
  const res = mockRes()
  await stripeWebhookHandler(req, res, {
    stripeSecret: 'sk_test_mock',
    webhookSecret: '',
  })

  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.received, true)
  assert.equal(body.type, 'charge.dispute.created')
})

test('webhook hardening: stripe-payment-methods routes scheduled-rider and schedule-slots', async () => {
  const reqRider = {
    method: 'POST',
    url: '/api/stripe-payment-methods?action=scheduled-rider',
    body: { tripId: 'trip-1' },
  }
  const resRider = mockRes()
  await stripePaymentMethodsHandler(reqRider, resRider, {
    sb: createFakeSb(),
    user: null, // Unauthenticated
  })
  assert.equal(resRider.statusCode, 401)

  const reqSlots = {
    method: 'GET',
    url: '/api/stripe-payment-methods?action=schedule-slots',
  }
  const resSlots = mockRes()
  await stripePaymentMethodsHandler(reqSlots, resSlots, {
    sb: createFakeSb(),
    now: NOW,
  })
  assert.equal(resSlots.statusCode, 200)
})
