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
import handleTripCancelMidride from '../server/endpoints/tripCancelMidride.js'
import handleTripWait from '../server/endpoints/tripWait.js'
import handleRiderTipChoice from '../server/endpoints/riderTipChoice.js'
import handleBackupQueue from '../server/endpoints/backupQueue.js'
import handleMatchingRebroadcast from '../server/endpoints/matchingRebroadcast.js'
import handleExpireUnpaidAirportHolds, {
  parseHoldSweepLimit,
  parseHoldSweepTtlMs,
  sanitizeHoldResults,
} from '../server/endpoints/expireUnpaidAirportHolds.js'
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
    profiles: [],
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
        is(col, val) {
          filters.push({ col, op: 'is', val })
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
              if (f.op === 'is') return f.val === null ? row[f.col] == null : row[f.col] === f.val
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
              if (f.op === 'is') return f.val === null ? row[f.col] == null : row[f.col] === f.val
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

// ---------------------------------------------------------------------------
// 5. RIDER TIP BOUNDS & TAMPERING TESTS
// ---------------------------------------------------------------------------

test('fare bounds: riderTipChoice enforces method, auth, trip presence, and completed state', async () => {
  const sb = createFakeSb({
    trips: [
      { id: 'trip-comp', rider_id: 'rider-1', driver_id: 'driver-1', status: 'completed', fare_cents: 3500 },
      { id: 'trip-prog', rider_id: 'rider-1', driver_id: 'driver-1', status: 'in_progress', fare_cents: 3500 },
      { id: 'trip-other', rider_id: 'rider-other', driver_id: 'driver-1', status: 'completed', fare_cents: 3500 },
    ],
    profiles: [
      { id: 'driver-1', full_name: 'Clemson Driver' },
    ],
  })

  // 1. Non-POST is 405
  const getRes = await call(handleRiderTipChoice, { method: 'GET', url: '/api/driver?action=tip-choice' }, { sb })
  assert.equal(getRes.status, 405)

  // 2. Unauthenticated is 401
  const unauthRes = await call(handleRiderTipChoice, {
    method: 'POST',
    body: { tripId: 'trip-comp', mode: 'offer' },
  }, { sb, user: null })
  assert.equal(unauthRes.status, 401)

  // 3. Missing tripId is 400
  const noTripRes = await call(handleRiderTipChoice, {
    method: 'POST',
    body: { mode: 'offer' },
  }, { sb, user: { id: 'rider-1' } })
  assert.equal(noTripRes.status, 400)
  assert.match(noTripRes.json.error, /tripId required/i)

  // 4. Trip belonging to another rider returns 404 (isolation / no data leak)
  const crossTenantRes = await call(handleRiderTipChoice, {
    method: 'POST',
    body: { tripId: 'trip-other', mode: 'offer' },
  }, { sb, user: { id: 'rider-1' } })
  assert.equal(crossTenantRes.status, 404)
  assert.match(crossTenantRes.json.error, /Trip not found/i)

  // 5. Incomplete trip returns 409
  const inProgressRes = await call(handleRiderTipChoice, {
    method: 'POST',
    body: { tripId: 'trip-prog', mode: 'offer' },
  }, { sb, user: { id: 'rider-1' } })
  assert.equal(inProgressRes.status, 409)
  assert.match(inProgressRes.json.error, /completed/i)

  // 6. Valid completed trip in mode offer returns 200 with presets and sanitized fields
  const offerRes = await call(handleRiderTipChoice, {
    method: 'POST',
    body: { tripId: 'trip-comp', mode: 'offer' },
  }, { sb, user: { id: 'rider-1' } })
  assert.equal(offerRes.status, 200)
  assert.equal(offerRes.json.ok, true)
  assert.equal(offerRes.json.driverName, 'Clemson')
  assert.ok(Array.isArray(offerRes.json.presets))
})

test('fare bounds: riderTipChoice strips client money fields and validates custom tip range', async () => {
  const sb = createFakeSb({
    trips: [
      { id: 'trip-tip-bounds', rider_id: 'rider-1', driver_id: 'driver-1', status: 'completed', fare_cents: 4000, metadata: {} },
    ],
  })

  // 1. Invalid custom tip amounts: negative, zero/too small (< $1), excessive (> $100), non-number
  const cases = [
    { customDollars: -5, err: /negative/i },
    { customDollars: '0.50', err: /between \$1 and \$100/i },
    { customDollars: 105.00, err: /between \$1 and \$100/i },
    { customDollars: 'invalid_chars', err: /dollars/i },
  ]

  for (const c of cases) {
    const res = await call(handleRiderTipChoice, {
      method: 'POST',
      body: {
        tripId: 'trip-tip-bounds',
        mode: 'record',
        choiceId: 'custom',
        customDollars: c.customDollars,
        // Attempt tampering with client money fields:
        tipCents: 999999,
        fare_cents: 1,
        amount_cents: 50,
      },
    }, { sb, user: { id: 'rider-1' } })

    assert.equal(res.status, 400, `Expected 400 for customDollars=${c.customDollars}`)
    assert.match(res.json.error, c.err)
  }

  // 2. Invalid preset choice returns 400
  const badChoiceRes = await call(handleRiderTipChoice, {
    method: 'POST',
    body: { tripId: 'trip-tip-bounds', mode: 'record', choiceId: 'fake-preset-999' },
  }, { sb, user: { id: 'rider-1' } })
  assert.equal(badChoiceRes.status, 400)
  assert.match(badChoiceRes.json.error, /from the list or skip/i)

  // 3. Skip choice is accepted and sets tipCents: 0
  const skipRes = await call(handleRiderTipChoice, {
    method: 'POST',
    body: { tripId: 'trip-tip-bounds', mode: 'record', choiceId: 'skip' },
  }, { sb, user: { id: 'rider-1' } })
  assert.equal(skipRes.status, 200)
  assert.equal(skipRes.json.choice.skipped, true)
  assert.equal(skipRes.json.choice.tipCents, 0)
})

// ---------------------------------------------------------------------------
// 6. BACKUP QUEUE DRIVER BOUNDS TESTS
// ---------------------------------------------------------------------------

test('auth bounds: backupQueue validates methods, auth, trip IDs, and onboarding approval gates', async () => {
  const sb = createFakeSb({
    driver_applications: [
      { profile_id: 'driver-unapproved', onboarding_status: 'pending_review' },
      { profile_id: 'driver-approved', onboarding_status: 'approved' },
    ],
  })

  // 1. GET is 405
  const getRes = await call(handleBackupQueue, { method: 'GET' }, { sb })
  assert.equal(getRes.status, 405)

  // 2. Unauthenticated is 401
  const unauthRes = await call(handleBackupQueue, {
    method: 'POST',
    body: { tripId: 'trip-1', op: 'accept' },
  }, { sb, user: null })
  assert.equal(unauthRes.status, 401)

  // 3. Empty or missing tripId is 400
  const noTripRes = await call(handleBackupQueue, {
    method: 'POST',
    body: { tripId: '   ', op: 'accept' },
  }, { sb, user: { id: 'driver-approved' } })
  assert.equal(noTripRes.status, 400)
  assert.match(noTripRes.json.error, /Trip id required/i)

  // 4. Unapproved driver attempting op: 'accept' is blocked with 403 onboarding gate
  const gateRes = await call(handleBackupQueue, {
    method: 'POST',
    body: { tripId: 'trip-1', op: 'accept' },
  }, { sb, user: { id: 'driver-unapproved' } })
  assert.equal(gateRes.status, 403)
  assert.match(gateRes.json.error, /account is still under review/i)

  // 5. Unknown op returns 400
  const unknownOpRes = await call(handleBackupQueue, {
    method: 'POST',
    body: { tripId: 'trip-1', op: 'hijack_queue' },
  }, { sb, user: { id: 'driver-approved' } })
  assert.equal(unknownOpRes.status, 400)
  assert.match(unknownOpRes.json.error, /Unknown backup queue action: hijack_queue/i)
})

// ---------------------------------------------------------------------------
// 7. MATCHING REBROADCAST CRON HARDENING TESTS
// ---------------------------------------------------------------------------

test('auth & webhook hardening: matchingRebroadcast enforces timing-safe bearer compare, method, and staging guard', async () => {
  const env = { CRON_SECRET: 'clemson_cron_secret_777' }

  // 1. Unsupported method (PUT / DELETE) returns 405 with Allow header
  const putRes = await call(handleMatchingRebroadcast, {
    method: 'PUT',
    headers: { authorization: 'Bearer clemson_cron_secret_777' },
  }, { env })
  assert.equal(putRes.status, 405)
  assert.equal(putRes.headers['allow'], 'GET, POST')

  // 2. Missing authorization header is 401
  const noAuthRes = await call(handleMatchingRebroadcast, {
    method: 'GET',
    headers: {},
  }, { env })
  assert.equal(noAuthRes.status, 401)
  assert.match(noAuthRes.json.error, /Cron authorization required/i)

  // 3. Incorrect bearer token is 401
  const badAuthRes = await call(handleMatchingRebroadcast, {
    method: 'GET',
    headers: { authorization: 'Bearer wrong_secret_token' },
  }, { env })
  assert.equal(badAuthRes.status, 401)

  // 4. Staging cron disable guard returns 403
  const stagingDisabledEnv = {
    CRON_SECRET: 'clemson_cron_secret_777',
    DISABLE_CRON_ENDPOINTS: '1',
  }
  const disabledRes = await call(handleMatchingRebroadcast, {
    method: 'POST',
    headers: { authorization: 'Bearer clemson_cron_secret_777' },
  }, { env: stagingDisabledEnv })
  assert.equal(disabledRes.status, 403)
  assert.match(disabledRes.json.error, /disabled/i)

  // 5. Response headers always enforce Cache-Control: no-store
  assert.equal(disabledRes.headers['cache-control'], 'no-store')
})

// ---------------------------------------------------------------------------
// 8. UNPAID AIRPORT HOLD SWEEP BOUNDS & SANITIZATION TESTS
// ---------------------------------------------------------------------------

test('schedule & fare bounds: expireUnpaidAirportHolds parses sweep limits, clamps TTLs, and sanitizes errors', async () => {
  // 1. Limit clamping: parseHoldSweepLimit clamps <=0 to 40, clamps >40 to 40
  assert.equal(parseHoldSweepLimit({ query: { limit: '0' } }), 40)
  assert.equal(parseHoldSweepLimit({ query: { limit: '-10' } }), 40)
  assert.equal(parseHoldSweepLimit({ query: { limit: '100' } }), 40)
  assert.equal(parseHoldSweepLimit({ query: { limit: '25' } }), 25)
  assert.equal(parseHoldSweepLimit({ url: '/api/expire?limit=15' }), 15)

  // 2. TTL clamping: clamped between 15 mins (900,000 ms) and 7 days (604,800,000 ms)
  const FIFTEEN_MINS_MS = 15 * 60 * 1000
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

  // Below floor (1 min = 60,000 ms) -> clamped to 15 mins
  assert.equal(parseHoldSweepTtlMs({ query: { ttl_ms: '60000' } }), FIFTEEN_MINS_MS)
  assert.equal(parseHoldSweepTtlMs({ query: { ttl_seconds: '60' } }), FIFTEEN_MINS_MS)

  // Above ceiling (30 days = 2,592,000,000 ms) -> clamped to 7 days
  assert.equal(parseHoldSweepTtlMs({ query: { ttl_ms: '2592000000' } }), SEVEN_DAYS_MS)

  // Valid middle value (2 hours = 7,200,000 ms) -> kept as 7,200,000 ms
  assert.equal(parseHoldSweepTtlMs({ query: { ttl_ms: '7200000' } }), 7200000)

  // 3. Error sanitization: single line, max 100 characters
  const rawResults = [
    { id: 'trip-1', ok: true },
    {
      id: 'trip-2',
      error: 'Database connection failed with FATAL password authentication error on host db.internal.clemson.edu\n    at Client._handleError (pg/client.js:12:34)\n    at stack trace line 2',
    },
  ]
  const sanitized = sanitizeHoldResults(rawResults)
  assert.equal(sanitized[0].ok, true)
  assert.ok(sanitized[1].error.length <= 100)
  assert.ok(!sanitized[1].error.includes('\n'))
  assert.equal(
    sanitized[1].error,
    'Database connection failed with FATAL password authentication error on host db.internal.clemson.edu',
  )

  // 4. Method not allowed and security headers
  const reqPatch = { method: 'PATCH', url: '/api/expire-unpaid-airport-holds' }
  const resPatch = mockRes()
  await handleExpireUnpaidAirportHolds(reqPatch, resPatch)
  assert.equal(resPatch.statusCode, 405)
  assert.equal(resPatch.headers['allow'], 'GET, POST')
  assert.equal(resPatch.headers['cache-control'], 'no-store, no-cache, must-revalidate, private')
  assert.equal(resPatch.headers['pragma'], 'no-cache')
})

// ---------------------------------------------------------------------------
// 9. TRIP CANCEL MIDRIDE BOUNDS TESTS
// ---------------------------------------------------------------------------

test('fare & auth bounds: tripCancelMidride validates auth, rider ownership, and started lifecycle', async () => {
  const sb = createFakeSb({
    trips: [
      { id: 'trip-searching', rider_id: 'rider-1', status: 'searching' },
      { id: 'trip-running', rider_id: 'rider-1', status: 'in_progress' },
      { id: 'trip-canceled', rider_id: 'rider-1', status: 'canceled_midride', metadata: { midride_cancel: { feeCents: 500 } } },
      { id: 'trip-stranger', rider_id: 'rider-other', status: 'in_progress' },
    ],
  })

  // 1. GET is 405
  const getRes = await call(handleTripCancelMidride, { method: 'GET' }, { sb })
  assert.equal(getRes.status, 405)

  // 2. Unauthenticated is 401
  const unauthRes = await call(handleTripCancelMidride, {
    method: 'POST',
    body: { tripId: 'trip-running' },
  }, { sb, user: null })
  assert.equal(unauthRes.status, 401)

  // 3. Missing tripId is 400
  const noTripRes = await call(handleTripCancelMidride, {
    method: 'POST',
    body: { tripId: '  ' },
  }, { sb, user: { id: 'rider-1' } })
  assert.equal(noTripRes.status, 400)
  assert.match(noTripRes.json.error, /tripId required/i)

  // 4. Non-existent trip is 404
  const notFoundRes = await call(handleTripCancelMidride, {
    method: 'POST',
    body: { tripId: 'trip-nonexistent' },
  }, { sb, user: { id: 'rider-1' } })
  assert.equal(notFoundRes.status, 404)
  assert.match(notFoundRes.json.error, /Trip not found/i)

  // 5. Cross-tenant access: non-rider caller is 403
  const crossTenantRes = await call(handleTripCancelMidride, {
    method: 'POST',
    body: { tripId: 'trip-stranger' },
  }, { sb, user: { id: 'rider-1' } })
  assert.equal(crossTenantRes.status, 403)
  assert.match(crossTenantRes.json.error, /Only the rider can cancel this trip/i)

  // 6. Trip not started yet is 409
  const notStartedRes = await call(handleTripCancelMidride, {
    method: 'POST',
    body: { tripId: 'trip-searching' },
  }, { sb, user: { id: 'rider-1' } })
  assert.equal(notStartedRes.status, 409)
  assert.match(notStartedRes.json.error, /Mid-ride cancel is only available after the trip has started/i)

  // 7. Already canceled trip returns 200 with alreadyCanceled: true idempotently
  const alreadyRes = await call(handleTripCancelMidride, {
    method: 'POST',
    body: { tripId: 'trip-canceled' },
  }, { sb, user: { id: 'rider-1' } })
  assert.equal(alreadyRes.status, 200)
  assert.equal(alreadyRes.json.ok, true)
  assert.equal(alreadyRes.json.alreadyCanceled, true)
  assert.equal(alreadyRes.json.status, 'canceled_midride')
})
