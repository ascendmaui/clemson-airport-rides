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
import handleTripTip from '../server/endpoints/tripTip.js'
import handleRiderTipChoice from '../server/endpoints/riderTipChoice.js'
import handleBackupQueue from '../server/endpoints/backupQueue.js'
import handleMatchingRebroadcast from '../server/endpoints/matchingRebroadcast.js'
import handleExpireUnpaidAirportHolds, {
  parseHoldSweepLimit,
  parseHoldSweepTtlMs,
  sanitizeHoldResults,
} from '../server/endpoints/expireUnpaidAirportHolds.js'
import handleWeeklyCoupon from '../server/endpoints/weeklyCoupon.js'
import handleCollectPayment from '../server/endpoints/collectPayment.js'
import handleTigerPass from '../server/endpoints/tigerPass.js'
import handleFavoriteDrivers from '../server/endpoints/favoriteDrivers.js'
import handleBuyCredits from '../server/endpoints/buyCredits.js'
import handleCreditsConfirm from '../server/endpoints/creditsConfirm.js'
import handleTripOfferPreview from '../server/endpoints/tripOfferPreview.js'
import handleTripSettle from '../server/endpoints/tripSettle.js'
import handleAbandonCheckout from '../server/endpoints/abandonCheckout.js'
import handleReconcileCheckout from '../server/endpoints/reconcileCheckout.js'
import handleClemsonMiamiCheckout from '../server/endpoints/clemsonMiamiCheckout.js'
import handleApplicantInbox from '../server/endpoints/applicantInbox.js'
import handleDriverCards from '../server/endpoints/driverCards.js'
import handleScheduleTrip from '../server/endpoints/scheduleTrip.js'
import handleRequestDriverTrip from '../server/endpoints/requestDriverTrip.js'
import { handleMarkOffered, handlePassOffer } from '../server/endpoints/driverOfferDesk.js'
import carpoolHandler from '../api/carpool.js'
import handleRiderSwitch from '../api/rider-switch.js'
import handleTripMessages from '../api/trip-messages.js'
import handleTigerHeat from '../api/tiger-heat.js'
import handleFriendRides from '../api/friend-rides.js'
import handleRiderLive from '../api/rider-live.js'
import { publishRiderPickup } from '../server/endpoints/riderLivePickup.js'
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
    rider_subscriptions: [],
    rider_credit_lots: [],
    rider_credit_ledger: [],
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
        gt(col, val) {
          filters.push({ col, op: 'gt', val })
          return chain
        },
        gte(col, val) {
          filters.push({ col, op: 'gte', val })
          return chain
        },
        lte(col, val) {
          filters.push({ col, op: 'lte', val })
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
              if (f.op === 'gt') return row[f.col] > f.val
              if (f.op === 'gte') return row[f.col] >= f.val
              if (f.op === 'lte') return row[f.col] <= f.val
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
              if (f.op === 'gt') return row[f.col] > f.val
              if (f.op === 'gte') return row[f.col] >= f.val
              if (f.op === 'lte') return row[f.col] <= f.val
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
        upsert: (rowOrRows, opts = {}) => {
          const incoming = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
          const onConflict = opts.onConflict || 'id'
          const results = []
          for (const item of incoming) {
            const idx = tables[table].findIndex((r) => r[onConflict] === item[onConflict])
            if (idx >= 0) {
              tables[table][idx] = { ...tables[table][idx], ...item }
              results.push(tables[table][idx])
            } else {
              const entry = { id: item.id || `gen-${Math.random().toString(36).slice(2, 9)}`, ...item }
              tables[table].push(entry)
              results.push(entry)
            }
          }
          return {
            select: () => ({
              single: async () => ({ data: results[0] || null, error: null }),
              maybeSingle: async () => ({ data: results[0] || null, error: null }),
            }),
            then(resolve) {
              resolve({ data: results, error: null })
            },
          }
        },
        update: (patch) => {
          const updateFilters = []
          const updateObj = {
            eq(col, val) {
              updateFilters.push({ col, op: 'eq', val })
              return updateObj
            },
            is(col, val) {
              updateFilters.push({ col, op: 'is', val })
              return updateObj
            },
            in(col, vals) {
              updateFilters.push({ col, op: 'in', val: vals })
              return updateObj
            },
            select: () => ({
              single: async () => {
                const target = tables[table].find((row) =>
                  updateFilters.every((f) => {
                    if (f.op === 'eq') {
                      if (f.col === 'metadata' && row.metadata && f.val) {
                        return JSON.stringify(row.metadata) === (typeof f.val === 'string' ? f.val : JSON.stringify(f.val))
                      }
                      return row[f.col] === f.val
                    }
                    if (f.op === 'is') return f.val === null ? row[f.col] == null : row[f.col] === f.val
                    if (f.op === 'in') return Array.isArray(f.val) ? f.val.includes(row[f.col]) : false
                    return true
                  })
                )
                if (target) Object.assign(target, patch)
                return { data: target || null, error: null }
              },
              maybeSingle: async () => {
                const target = tables[table].find((row) =>
                  updateFilters.every((f) => {
                    if (f.op === 'eq') {
                      if (f.col === 'metadata' && row.metadata && f.val) {
                        return JSON.stringify(row.metadata) === (typeof f.val === 'string' ? f.val : JSON.stringify(f.val))
                      }
                      return row[f.col] === f.val
                    }
                    if (f.op === 'is') return f.val === null ? row[f.col] == null : row[f.col] === f.val
                    if (f.op === 'in') return Array.isArray(f.val) ? f.val.includes(row[f.col]) : false
                    return true
                  })
                )
                if (target) Object.assign(target, patch)
                return { data: target || null, error: null }
              },
            }),
            then(resolve) {
              const matches = tables[table].filter((row) =>
                updateFilters.every((f) => {
                  if (f.op === 'eq') {
                    if (f.col === 'metadata' && row.metadata && f.val) {
                      return JSON.stringify(row.metadata) === (typeof f.val === 'string' ? f.val : JSON.stringify(f.val))
                    }
                    return row[f.col] === f.val
                  }
                  if (f.op === 'is') return f.val === null ? row[f.col] == null : row[f.col] === f.val
                  if (f.op === 'in') return Array.isArray(f.val) ? f.val.includes(row[f.col]) : false
                  return true
                })
              )
              for (const m of matches) Object.assign(m, patch)
              resolve({ data: matches, error: null })
            },
          }
          return updateObj
        },
        then(resolve) {
          let rows = tables[table].filter((row) =>
            filters.every((f) => {
              if (f.op === 'eq') return row[f.col] === f.val
              if (f.op === 'is') return f.val === null ? row[f.col] == null : row[f.col] === f.val
              if (f.op === 'in') return Array.isArray(f.val) ? f.val.includes(row[f.col]) : false
              if (f.op === 'gt') return row[f.col] > f.val
              if (f.op === 'gte') return row[f.col] >= f.val
              if (f.op === 'lte') return row[f.col] <= f.val
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

// ---------------------------------------------------------------------------
// 10. WEEKLY COUPON PROMO & CRON BOUNDS TESTS
// ---------------------------------------------------------------------------

test('fare & cron bounds: weeklyCoupon enforces public GET access, cron auth, method restrictions, and staging guards', async () => {
  const env = { CRON_SECRET: 'weekly_cron_sec_555' }

  // 1. Public GET returns 200 with coupon details and standing offers without requiring auth
  const getRes = await call(handleWeeklyCoupon, { method: 'GET', url: '/api/weekly-coupon' })
  assert.equal(getRes.status, 200)
  assert.ok(getRes.json.coupon)
  assert.equal(getRes.json.timeZone, 'America/New_York')
  assert.ok(Array.isArray(getRes.json.standingOffers))

  // 2. Unsupported HTTP method (e.g. DELETE / PUT) returns 405 with Allow header
  const deleteRes = await call(handleWeeklyCoupon, { method: 'DELETE', url: '/api/weekly-coupon' })
  assert.equal(deleteRes.status, 405)
  assert.equal(deleteRes.headers['allow'], 'GET, POST, OPTIONS')

  // 3. POST without bearer token returns 401
  const noAuthRes = await call(handleWeeklyCoupon, { method: 'POST', url: '/api/weekly-coupon' }, { env })
  assert.equal(noAuthRes.status, 401)
  assert.equal(noAuthRes.json.skipped, true)
  assert.match(noAuthRes.json.reason, /Set CRON_SECRET/i)

  // 4. POST with incorrect bearer token returns 401
  const badAuthRes = await call(handleWeeklyCoupon, {
    method: 'POST',
    url: '/api/weekly-coupon',
    headers: { authorization: 'Bearer wrong_token' },
  }, { env })
  assert.equal(badAuthRes.status, 401)
  assert.equal(badAuthRes.json.skipped, true)

  // 5. POST with staging cron disable flag returns 403
  const stagingEnv = { CRON_SECRET: 'weekly_cron_sec_555', DISABLE_CRON_ENDPOINTS: '1' }
  const blockedRes = await call(handleWeeklyCoupon, {
    method: 'POST',
    url: '/api/weekly-coupon',
    headers: { authorization: 'Bearer weekly_cron_sec_555' },
  }, { env: stagingEnv })
  assert.equal(blockedRes.status, 403)
  assert.match(blockedRes.json.error, /disabled/i)

  // 6. POST with valid bearer token but missing sb client returns 503
  const noSbRes = await call(handleWeeklyCoupon, {
    method: 'POST',
    url: '/api/weekly-coupon',
    headers: { authorization: 'Bearer weekly_cron_sec_555' },
  }, { env, sb: null, store: null })
  assert.equal(noSbRes.status, 503)
  assert.match(noSbRes.json.error, /SUPABASE_SERVICE_ROLE_KEY not configured/i)

  // 7. POST outside Friday drop hour skips cleanly with reason outside_friday_drop_hour
  const mockStore = {
    find: async () => null,
    claim: async () => true,
    listRecipients: async () => [],
    listPushTokens: async () => [],
  }
  const skipWindowRes = await call(handleWeeklyCoupon, {
    method: 'POST',
    url: '/api/weekly-coupon?dry_run=1',
    headers: { authorization: 'Bearer weekly_cron_sec_555' },
  }, { env, store: mockStore, dryRun: true, force: false })
  assert.equal(skipWindowRes.status, 200)
  assert.equal(skipWindowRes.json.skipped, true)
  assert.equal(skipWindowRes.json.reason, 'outside_friday_drop_hour')

  // 8. POST with force: true proceeds to dry-run
  const dryRunRes = await call(handleWeeklyCoupon, {
    method: 'POST',
    url: '/api/weekly-coupon?dry_run=1',
    headers: { authorization: 'Bearer weekly_cron_sec_555' },
  }, { env, store: mockStore, dryRun: true, force: true })
  assert.equal(dryRunRes.status, 200)
  assert.equal(dryRunRes.json.dryRun, true)
  assert.equal(dryRunRes.json.skipped, false)
})

// ---------------------------------------------------------------------------
// 11. COLLECT PAYMENT FARE & AUTH BOUNDS TESTS
// ---------------------------------------------------------------------------

test('fare & auth bounds: collectPayment validates method, auth, payment kinds, tenant isolation, and Stripe configuration', async () => {
  const sb = createFakeSb({
    trips: [
      { id: 'trip-rider-1', rider_id: 'rider-1', driver_id: 'driver-1', fare_cents: 2500, deposit_cents: 500, status: 'completed' },
      { id: 'trip-rider-2', rider_id: 'rider-2', driver_id: 'driver-2', fare_cents: 2500, deposit_cents: 500, status: 'completed' },
    ],
    payments: [
      { id: 'pay-dep-1', trip_id: 'trip-rider-1', kind: 'deposit', status: 'succeeded', amount_cents: 500 },
    ],
  })

  // 1. Non-POST returns 405
  const getRes = await call(handleCollectPayment, { method: 'GET', url: '/api/collect-payment' }, { sb })
  assert.equal(getRes.status, 405)

  // 2. Unauthenticated returns 401
  const unauthRes = await call(handleCollectPayment, {
    method: 'POST',
    body: { tripId: 'trip-rider-1', kind: 'balance' },
  }, { sb, user: null })
  assert.equal(unauthRes.status, 401)

  // 3. Missing service client returns 503
  const noSbRes = await call(handleCollectPayment, {
    method: 'POST',
    body: { tripId: 'trip-rider-1', kind: 'balance' },
  }, { sb: null, user: { id: 'rider-1' } })
  assert.equal(noSbRes.status, 503)

  // 4. Unsupported payment kind returns 400
  const badKindRes = await call(handleCollectPayment, {
    method: 'POST',
    body: { tripId: 'trip-rider-1', kind: 'unsupported_bribe' },
  }, { sb, user: { id: 'rider-1' } })
  assert.equal(badKindRes.status, 400)
  assert.match(badKindRes.json.error, /Unsupported payment kind/i)

  // 5. Non-existent trip returns 404
  const notFoundRes = await call(handleCollectPayment, {
    method: 'POST',
    body: { tripId: 'trip-missing', kind: 'balance' },
  }, { sb, user: { id: 'rider-1' } })
  assert.equal(notFoundRes.status, 404)
  assert.match(notFoundRes.json.error, /Trip not found/i)

  // 6. Cross-tenant trip access: caller who is neither rider nor driver returns 403
  const forbiddenRes = await call(handleCollectPayment, {
    method: 'POST',
    body: { tripId: 'trip-rider-2', kind: 'balance' },
  }, { sb, user: { id: 'rider-1' } })
  assert.equal(forbiddenRes.status, 403)
  assert.match(forbiddenRes.json.error, /Not allowed on this trip/i)

  // 7. Missing Stripe configuration when amount > 0 returns 503
  const stripeUnconfiguredRes = await call(handleCollectPayment, {
    method: 'POST',
    body: { tripId: 'trip-rider-1', kind: 'balance' },
  }, {
    sb,
    user: { id: 'rider-1' },
    stripeOk: () => false,
    stripe: null,
  })
  assert.equal(stripeUnconfiguredRes.status, 503)
  assert.match(stripeUnconfiguredRes.json.error, /Payments unavailable/i)

  // 8. Successful collection delegation forwards authoritative calculated cents
  let collectedPayload = null
  const mockCollectPayment = async (args) => {
    collectedPayload = args
    return { ok: true, id: 'pi_test_123', status: 'succeeded' }
  }

  const successRes = await call(handleCollectPayment, {
    method: 'POST',
    body: {
      tripId: 'trip-rider-1',
      kind: 'balance',
      // Client tries to spoof amount:
      amountCents: 10,
      total: 10,
    },
  }, {
    sb,
    user: { id: 'rider-1' },
    stripeOk: () => true,
    stripe: { paymentIntents: {} },
    collectPayment: mockCollectPayment,
  })

  assert.equal(successRes.status, 200)
  assert.equal(successRes.json.ok, true)
  assert.ok(collectedPayload)
  // Authoritative server balance: 2500 fare - 500 deposit = 2000 cents (not spoofed 10 cents)
  assert.equal(collectedPayload.amountCents, 2000)
  assert.equal(collectedPayload.tripId, 'trip-rider-1')
})

// ---------------------------------------------------------------------------
// 12. TRIP TIP BOUNDS & ERROR STATUS CODE TESTS
// ---------------------------------------------------------------------------

test('fare & auth bounds: tripTip validates method, auth, status bounds, and tip ranges', async () => {
  const sb = createFakeSb({
    trips: [
      { id: 'trip-comp-untipped', rider_id: 'rider-1', driver_id: 'driver-1', fare_cents: 3000, tip_cents: null, status: 'completed' },
      { id: 'trip-comp-tipped', rider_id: 'rider-1', driver_id: 'driver-1', fare_cents: 3000, tip_cents: 500, status: 'completed' },
      { id: 'trip-not-done', rider_id: 'rider-1', driver_id: 'driver-1', fare_cents: 3000, tip_cents: null, status: 'in_progress' },
      { id: 'trip-alien', rider_id: 'rider-stranger', driver_id: 'driver-1', fare_cents: 3000, tip_cents: null, status: 'completed' },
    ],
    profiles: [
      { id: 'rider-1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' },
    ],
  })

  // 1. Non-POST returns 405
  const getRes = await call(handleTripTip, { method: 'GET', url: '/api/trip-tip' }, { sb })
  assert.equal(getRes.status, 405)

  // 2. Stripe unconfigured returns 503
  const noStripeRes = await call(handleTripTip, {
    method: 'POST',
    body: { tripId: 'trip-comp-untipped', tipCents: 500 },
  }, { sb, stripeOk: () => false, stripe: null })
  assert.equal(noStripeRes.status, 503)
  assert.match(noStripeRes.json.error, /Payments unavailable/i)

  // 3. Unauthenticated returns 401
  const unauthRes = await call(handleTripTip, {
    method: 'POST',
    body: { tripId: 'trip-comp-untipped', tipCents: 500 },
  }, { sb, stripeOk: () => true, stripe: {}, user: null })
  assert.equal(unauthRes.status, 401)

  // 4. Missing tripId returns 400
  const noTripRes = await call(handleTripTip, {
    method: 'POST',
    body: { tipCents: 500 },
  }, { sb, stripeOk: () => true, stripe: {}, user: { id: 'rider-1' } })
  assert.equal(noTripRes.status, 400)
  assert.match(noTripRes.json.error, /tripId required/i)

  // 5. Cross-tenant trip ownership returns 404 (isolation / no data leak)
  const crossTenantRes = await call(handleTripTip, {
    method: 'POST',
    body: { tripId: 'trip-alien', tipCents: 500 },
  }, { sb, stripeOk: () => true, stripe: {}, user: { id: 'rider-1' } })
  assert.equal(crossTenantRes.status, 404)
  assert.match(crossTenantRes.json.error, /Trip not found/i)

  // 6. Incomplete trip returns 409
  const incompleteRes = await call(handleTripTip, {
    method: 'POST',
    body: { tripId: 'trip-not-done', tipCents: 500 },
  }, { sb, stripeOk: () => true, stripe: {}, user: { id: 'rider-1' } })
  assert.equal(incompleteRes.status, 409)
  assert.match(incompleteRes.json.error, /once the trip is completed/i)

  // 7. Already tipped trip returns 409
  const alreadyTippedRes = await call(handleTripTip, {
    method: 'POST',
    body: { tripId: 'trip-comp-tipped', tipCents: 500 },
  }, { sb, stripeOk: () => true, stripe: {}, user: { id: 'rider-1' } })
  assert.equal(alreadyTippedRes.status, 409)
  assert.match(alreadyTippedRes.json.error, /Tip already added/i)

  // 8. Tip amount bounds: sub-dollar (<100) or over $100 (>10000) returns 400
  const lowTipRes = await call(handleTripTip, {
    method: 'POST',
    body: { tripId: 'trip-comp-untipped', tipCents: 50 },
  }, { sb, stripeOk: () => true, stripe: {}, user: { id: 'rider-1' } })
  assert.equal(lowTipRes.status, 400)
  assert.match(lowTipRes.json.error, /between \$1 and \$100/i)

  const highTipRes = await call(handleTripTip, {
    method: 'POST',
    body: { tripId: 'trip-comp-untipped', tipCents: 15000 },
  }, { sb, stripeOk: () => true, stripe: {}, user: { id: 'rider-1' } })
  assert.equal(highTipRes.status, 400)
  assert.match(highTipRes.json.error, /between \$1 and \$100/i)

  // 9. Finalize mode: missing paymentIntentId returns 400
  const noPiRes = await call(handleTripTip, {
    method: 'POST',
    body: { tripId: 'trip-comp-untipped', mode: 'finalize' },
  }, { sb, stripeOk: () => true, stripe: {}, user: { id: 'rider-1' } })
  assert.equal(noPiRes.status, 400)
  assert.match(noPiRes.json.error, /paymentIntentId required/i)

  // 10. Finalize mode: cross-tenant payment intent mismatch returns 403
  const fakeStripe = {
    paymentIntents: {
      retrieve: async () => ({
        id: 'pi_alien',
        amount: 500,
        status: 'succeeded',
        metadata: { kind: 'tip', tripId: 'trip-comp-untipped', riderId: 'alien-rider' },
      }),
    },
  }
  const mismatchRes = await call(handleTripTip, {
    method: 'POST',
    body: { tripId: 'trip-comp-untipped', mode: 'finalize', paymentIntentId: 'pi_alien' },
  }, { sb, stripeOk: () => true, stripe: fakeStripe, user: { id: 'rider-1' } })
  assert.equal(mismatchRes.status, 403)
  assert.match(mismatchRes.json.error, /does not match this trip/i)
})

// ---------------------------------------------------------------------------
// 13. FAVORITE DRIVERS & TIGER PASS BOUNDS TESTS
// ---------------------------------------------------------------------------

test('fare & pass bounds: favoriteDrivers and tigerPass enforce methods, auth, demo filtering, and status gates', async () => {
  const sb = createFakeSb({
    profiles: [
      { id: 'rider-1', full_name: 'Clemson Rider', email: 'rider@clemson.edu', favorite_driver_ids: ['drv-1'] },
    ],
    rider_subscriptions: [
      {
        rider_id: 'rider-active',
        product_id: 'prod_tiger_pass',
        status: 'active',
        current_period_end: new Date('2026-11-10').toISOString(),
      },
    ],
  })

  // --- favoriteDrivers tests ---
  // 1. Method bounds: PUT/DELETE reject with 405
  const putFav = await call(handleFavoriteDrivers, { method: 'PUT' }, { sb })
  assert.equal(putFav.status, 405)

  // 2. Auth bounds: missing sb returns 503, missing user returns 401
  const noSbFav = await call(handleFavoriteDrivers, { method: 'GET' }, { sb: null })
  assert.equal(noSbFav.status, 503)

  const unauthFav = await call(handleFavoriteDrivers, { method: 'GET' }, { sb, user: null })
  assert.equal(unauthFav.status, 401)

  // 3. GET returns pass payload
  const getFav = await call(handleFavoriteDrivers, { method: 'GET' }, { sb, user: { id: 'rider-1' } })
  assert.equal(getFav.status, 200)
  assert.equal(Array.isArray(getFav.json.favoriteDriverIds), true)

  // 4. Invalid op returns 400
  const invalidOpFav = await call(handleFavoriteDrivers, {
    method: 'POST',
    body: { op: 'destroy' },
  }, { sb, user: { id: 'rider-1' }, ensureProfile: async () => ({ ok: true }) })
  assert.equal(invalidOpFav.status, 400)
  assert.match(invalidOpFav.json.error, /Unknown favorite action/i)

  // 5. op=set filters demo/preview and non-UUID drivers, retaining valid driver UUIDs
  const validDriverId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
  const setFav = await call(handleFavoriteDrivers, {
    method: 'POST',
    body: {
      op: 'set',
      driverIds: [validDriverId, 'demo-car-2', 'sim-busy-driver-3', 'non-uuid-tampered'],
    },
  }, { sb, user: { id: 'rider-1' }, ensureProfile: async () => ({ ok: true }) })
  assert.equal(setFav.status, 200)
  assert.equal(setFav.json.demoDriversIgnored, true)
  assert.deepEqual(setFav.json.favoriteDriverIds, [validDriverId])

  // --- tigerPass tests ---
  // 6. Method bounds: DELETE rejects with 405
  const delPass = await call(handleTigerPass, { method: 'DELETE' }, { sb })
  assert.equal(delPass.status, 405)

  // 7. Auth bounds: missing sb 503, missing user 401
  const noSbPass = await call(handleTigerPass, { method: 'GET' }, { sb: null })
  assert.equal(noSbPass.status, 503)

  const unauthPass = await call(handleTigerPass, { method: 'GET' }, { sb, user: null })
  assert.equal(unauthPass.status, 401)

  // 8. Invalid op returns 400
  const invalidOpPass = await call(handleTigerPass, {
    method: 'POST',
    body: { op: 'supercharge' },
  }, { sb, user: { id: 'rider-1' }, ensureProfile: async () => ({ ok: true }) })
  assert.equal(invalidOpPass.status, 400)
  assert.match(invalidOpPass.json.error, /Unknown pass action/i)

  // 9. op=checkout with unconfigured Stripe returns 503
  const noStripePass = await call(handleTigerPass, {
    method: 'POST',
    body: { op: 'checkout' },
  }, { sb, user: { id: 'rider-1' }, stripeOk: () => false, stripe: null, ensureProfile: async () => ({ ok: true }) })
  assert.equal(noStripePass.status, 503)

  // 10. op=checkout with already active subscription returns 409
  const fakeStripe = {
    checkout: {
      sessions: {
        create: async (params) => ({ id: 'cs_pass_123', url: 'https://checkout.stripe.com', ...params }),
      },
    },
  }
  const alreadyActivePass = await call(handleTigerPass, {
    method: 'POST',
    body: { op: 'checkout' },
  }, { sb, user: { id: 'rider-active' }, stripeOk: () => true, stripe: fakeStripe, ensureProfile: async () => ({ ok: true }) })
  assert.equal(alreadyActivePass.status, 409)
  assert.match(alreadyActivePass.json.error, /already active/i)
})

// ---------------------------------------------------------------------------
// 14. BUY CREDITS & CREDITS CONFIRM BOUNDS TESTS
// ---------------------------------------------------------------------------

test('fare & credit bounds: buyCredits and creditsConfirm validate methods, auth, pack bounds, and cross-tenant purchase isolation', async () => {
  const sb = createFakeSb({
    profiles: [
      { id: 'user-buyer', full_name: 'Buyer Tiger', email: 'buyer@clemson.edu' },
      { id: 'user-stranger', full_name: 'Stranger', email: 'stranger@clemson.edu' },
    ],
  })

  let createdCheckoutParams = null
  const fakeStripe = {
    checkout: {
      sessions: {
        create: async (params) => {
          createdCheckoutParams = params
          return { id: 'cs_cred_999', url: 'https://checkout.stripe.com/cs_cred_999' }
        },
        retrieve: async (sessionId) => {
          if (sessionId === 'cs_not_credit') {
            return { id: sessionId, payment_status: 'paid', metadata: { kind: 'fare_deposit' } }
          }
          if (sessionId === 'cs_alien') {
            return {
              id: sessionId,
              payment_status: 'paid',
              metadata: { kind: 'credit_purchase', profile_id: 'user-stranger', pack_id: 'pack_50' },
            }
          }
          if (sessionId === 'cs_unpaid') {
            return {
              id: sessionId,
              payment_status: 'unpaid',
              metadata: { kind: 'credit_purchase', profile_id: 'user-buyer', pack_id: 'pack_50' },
            }
          }
          return {
            id: sessionId,
            payment_status: 'paid',
            payment_intent: 'pi_cred_success',
            metadata: { kind: 'credit_purchase', profile_id: 'user-buyer', pack_id: 'pack_50' },
          }
        },
      },
    },
  }

  // --- buyCredits tests ---
  // 1. Non-POST returns 405 + Allow: POST, OPTIONS
  const getBuy = await call(handleBuyCredits, { method: 'GET' }, { sb })
  assert.equal(getBuy.status, 405)
  assert.match(getBuy.headers['Allow'] || getBuy.headers['allow'], /POST, OPTIONS/i)

  // 2. Stripe unconfigured returns 503
  const noStripeBuy = await call(handleBuyCredits, {
    method: 'POST',
    body: { packId: 'pack_50' },
  }, { sb, stripeOk: () => false, stripe: null })
  assert.equal(noStripeBuy.status, 503)

  // 3. Unauthenticated returns 401
  const unauthBuy = await call(handleBuyCredits, {
    method: 'POST',
    body: { packId: 'pack_50' },
  }, { sb, stripeOk: () => true, stripe: fakeStripe, user: null })
  assert.equal(unauthBuy.status, 401)

  // 4. Unknown credit pack returns 400
  const badPackBuy = await call(handleBuyCredits, {
    method: 'POST',
    body: { packId: 'pack_9999_hacked' },
  }, { sb, stripeOk: () => true, stripe: fakeStripe, user: { id: 'user-buyer' } })
  assert.equal(badPackBuy.status, 400)
  assert.match(badPackBuy.json.error, /Unknown credit pack/i)

  // 5. Valid pack strips client price tampering and uses authoritative server rates
  const validBuy = await call(handleBuyCredits, {
    method: 'POST',
    body: {
      packId: 'pack_50',
      loadCents: 999999, // tampered money field
      unit_amount: 100,  // tampered price field
    },
  }, { sb, stripeOk: () => true, stripe: fakeStripe, user: { id: 'user-buyer' } })
  assert.equal(validBuy.status, 200)
  assert.equal(validBuy.json.id, 'cs_cred_999')
  assert.equal(createdCheckoutParams.line_items[0].price_data.unit_amount, 5000)
  assert.equal(createdCheckoutParams.metadata.load_cents, '5000')
  assert.equal(createdCheckoutParams.metadata.discount_bps, '500')

  // --- creditsConfirm tests ---
  // 6. Non-POST returns 405
  const getConf = await call(handleCreditsConfirm, { method: 'GET' }, { sb })
  assert.equal(getConf.status, 405)

  // 7. Unauthenticated returns 401
  const unauthConf = await call(handleCreditsConfirm, {
    method: 'POST',
    body: { sessionId: 'cs_valid' },
  }, { sb, stripeOk: () => true, stripe: fakeStripe, user: null })
  assert.equal(unauthConf.status, 401)

  // 8. Missing sessionId returns 400
  const noSessionConf = await call(handleCreditsConfirm, {
    method: 'POST',
    body: {},
  }, { sb, stripeOk: () => true, stripe: fakeStripe, user: { id: 'user-buyer' } })
  assert.equal(noSessionConf.status, 400)
  assert.match(noSessionConf.json.error, /sessionId required/i)

  // 9. Non-credit purchase returns 400
  const notCredConf = await call(handleCreditsConfirm, {
    method: 'POST',
    body: { sessionId: 'cs_not_credit' },
  }, { sb, stripeOk: () => true, stripe: fakeStripe, user: { id: 'user-buyer' } })
  assert.equal(notCredConf.status, 400)
  assert.match(notCredConf.json.error, /Not a credit purchase/i)

  // 10. Cross-tenant purchase isolation returns 403
  const alienConf = await call(handleCreditsConfirm, {
    method: 'POST',
    body: { sessionId: 'cs_alien' },
  }, { sb, stripeOk: () => true, stripe: fakeStripe, user: { id: 'user-buyer' } })
  assert.equal(alienConf.status, 403)
  assert.match(alienConf.json.error, /Not your purchase/i)

  // 11. Unpaid session returns 409
  const unpaidConf = await call(handleCreditsConfirm, {
    method: 'POST',
    body: { sessionId: 'cs_unpaid' },
  }, { sb, stripeOk: () => true, stripe: fakeStripe, user: { id: 'user-buyer' } })
  assert.equal(unpaidConf.status, 409)
  assert.match(unpaidConf.json.error, /Payment not completed/i)

  // 12. Valid paid session confirms and grants pack
  const successConf = await call(handleCreditsConfirm, {
    method: 'POST',
    body: { sessionId: 'cs_valid_paid' },
  }, { sb, stripeOk: () => true, stripe: fakeStripe, user: { id: 'user-buyer' } })
  assert.equal(successConf.status, 200)
  assert.equal(successConf.json.ok, true)
  assert.equal(successConf.json.already, false)
  assert.equal(successConf.json.pack.id, 'pack_50')
})

// ---------------------------------------------------------------------------
// 15. TRIP OFFER PREVIEW PRIVACY & DRIVER BOUNDS TESTS
// ---------------------------------------------------------------------------

test('driver auth & privacy bounds: tripOfferPreview validates method, driver status, approval gates, and privacy display', async () => {
  const sb = createFakeSb({
    trips: [
      { id: 'trip-open', rider_id: 'rider-secret', driver_id: null, status: 'searching' },
      { id: 'trip-taken', rider_id: 'rider-secret', driver_id: 'other-driver', status: 'accepted' },
    ],
    driver_status: [
      { driver_id: 'driver-approved', is_online: true },
      { driver_id: 'driver-unapproved', is_online: true },
    ],
    profiles: [
      {
        id: 'rider-secret',
        full_name: 'Johnathon Doe-Clemson',
        email: 'secret_email@clemson.edu',
        phone: '864-555-1234',
        rating_avg: 4.92,
        rating_count: 18,
        standing: 'Good standing',
      },
    ],
  })

  // 1. Non-POST returns 405
  const getPrev = await call(handleTripOfferPreview, { method: 'GET' }, { sb })
  assert.equal(getPrev.status, 405)

  // 2. Auth bounds: missing sb returns 503, missing user returns 401
  const noSbPrev = await call(handleTripOfferPreview, { method: 'POST', body: { tripId: 'trip-open' } }, { sb: null })
  assert.equal(noSbPrev.status, 503)

  const unauthPrev = await call(handleTripOfferPreview, { method: 'POST', body: { tripId: 'trip-open' } }, { sb, user: null })
  assert.equal(unauthPrev.status, 401)

  // 3. Missing tripId returns 400
  const noTripPrev = await call(handleTripOfferPreview, { method: 'POST', body: {} }, { sb, user: { id: 'driver-approved' } })
  assert.equal(noTripPrev.status, 400)
  assert.match(noTripPrev.json.error, /tripId required/i)

  // 4. Non-driver caller returns 403
  const nonDriverPrev = await call(handleTripOfferPreview, {
    method: 'POST',
    body: { tripId: 'trip-open' },
  }, { sb, user: { id: 'random-rider' } })
  assert.equal(nonDriverPrev.status, 403)
  assert.match(nonDriverPrev.json.error, /Drivers only/i)

  // 5. Non-existent trip returns 404
  const notFoundPrev = await call(handleTripOfferPreview, {
    method: 'POST',
    body: { tripId: 'trip-ghost' },
  }, { sb, user: { id: 'driver-approved' } })
  assert.equal(notFoundPrev.status, 404)
  assert.match(notFoundPrev.json.error, /Trip not found/i)

  // 6. Unavailable trip (taken by another driver) returns 404
  const takenPrev = await call(handleTripOfferPreview, {
    method: 'POST',
    body: { tripId: 'trip-taken' },
  }, { sb, user: { id: 'driver-approved' } })
  assert.equal(takenPrev.status, 404)
  assert.match(takenPrev.json.error, /Trip not available/i)

  // 7. Unapproved driver blocked by onboarding gate returns 403
  const unapprovedPrev = await call(handleTripOfferPreview, {
    method: 'POST',
    body: { tripId: 'trip-open' },
  }, {
    sb,
    user: { id: 'driver-unapproved' },
    receivableDriverIds: async () => ({ allowed: new Set(), error: null }),
  })
  assert.equal(unapprovedPrev.status, 403)
  assert.equal(unapprovedPrev.json.code, 'driver_not_approved')

  // 8. Approved driver gets privacy-preserving preview (first name only, no email/phone)
  const approvedPrev = await call(handleTripOfferPreview, {
    method: 'POST',
    body: { tripId: 'trip-open' },
  }, {
    sb,
    user: { id: 'driver-approved' },
    receivableDriverIds: async () => ({ allowed: new Set(['driver-approved']), error: null }),
  })
  assert.equal(approvedPrev.status, 200)
  assert.equal(approvedPrev.json.riderFirstName, 'Johnathon')
  assert.equal(approvedPrev.json.ratingAvg, 4.92)
  assert.equal(approvedPrev.json.ratingCount, 18)
  assert.equal(approvedPrev.json.standing, 'Good standing')
  assert.equal(approvedPrev.json.email, undefined)
  assert.equal(approvedPrev.json.phone, undefined)
  assert.equal(approvedPrev.json.full_name, undefined)
})

// ---------------------------------------------------------------------------
// 16. RIDER LIVE PICKUP BOUNDS & ACCURACY GATE TESTS
// ---------------------------------------------------------------------------

test('fare & GPS bounds: riderLivePickup enforces method, auth, coordinate bounds, GPS accuracy, and trip lifecycle', async () => {
  const sb = createFakeSb({
    trips: [
      { id: 'trip-booking', rider_id: 'rider-live-1', driver_id: null, status: 'searching', metadata: {} },
      { id: 'trip-done', rider_id: 'rider-live-1', driver_id: 'driver-1', status: 'completed', metadata: {} },
      { id: 'trip-other', rider_id: 'stranger-rider', driver_id: null, status: 'searching', metadata: {} },
    ],
  })

  // 1. Non-POST returns 405
  const getLive = await call(handleRiderLive, { method: 'GET' }, { sb })
  assert.equal(getLive.status, 405)

  // 2. Auth bounds: missing sb returns 503, missing user returns 401
  const noSbLive = await call(handleRiderLive, { method: 'POST', body: { tripId: 'trip-booking', lat: 34.67, lng: -82.83 } }, { sb: null })
  assert.equal(noSbLive.status, 503)

  const unauthLive = await call(handleRiderLive, { method: 'POST', body: { tripId: 'trip-booking', lat: 34.67, lng: -82.83 } }, { sb, user: null })
  assert.equal(unauthLive.status, 401)

  // 3. Missing tripId returns 400
  const noTripLive = await call(handleRiderLive, {
    method: 'POST',
    body: { lat: 34.67, lng: -82.83 },
  }, { sb, user: { id: 'rider-live-1' } })
  assert.equal(noTripLive.status, 400)
  assert.match(noTripLive.json.error, /tripId required/i)

  // 4. Invalid latitude returns 400
  const badLatLive = await call(handleRiderLive, {
    method: 'POST',
    body: { tripId: 'trip-booking', lat: 95.0, lng: -82.83 },
  }, { sb, user: { id: 'rider-live-1' } })
  assert.equal(badLatLive.status, 400)
  assert.match(badLatLive.json.error, /latitude is required/i)

  // 5. Invalid longitude returns 400
  const badLngLive = await call(handleRiderLive, {
    method: 'POST',
    body: { tripId: 'trip-booking', lat: 34.67, lng: -195.0 },
  }, { sb, user: { id: 'rider-live-1' } })
  assert.equal(badLngLive.status, 400)
  assert.match(badLngLive.json.error, /longitude is required/i)

  // 6. Inaccurate GPS (>30m outdoor gate) rejected with 400
  const coarseGpsLive = await call(handleRiderLive, {
    method: 'POST',
    body: { tripId: 'trip-booking', lat: 34.67, lng: -82.83, accuracy: 45 },
  }, { sb, user: { id: 'rider-live-1' } })
  assert.equal(coarseGpsLive.status, 400)
  assert.match(coarseGpsLive.json.error, /Waiting for a closer GPS fix/i)

  // 7. Negative accuracy rejected with 400
  const negAccLive = await call(handleRiderLive, {
    method: 'POST',
    body: { tripId: 'trip-booking', lat: 34.67, lng: -82.83, accuracy: -5 },
  }, { sb, user: { id: 'rider-live-1' } })
  assert.equal(negAccLive.status, 400)
  assert.match(negAccLive.json.error, /Accuracy is not a distance/i)

  // 8. Cross-tenant trip ownership returns 404 (isolation)
  const crossTenantLive = await call(handleRiderLive, {
    method: 'POST',
    body: { tripId: 'trip-other', lat: 34.67, lng: -82.83, accuracy: 10 },
  }, { sb, user: { id: 'rider-live-1' } })
  assert.equal(crossTenantLive.status, 404)
  assert.match(crossTenantLive.json.error, /Trip not found/i)

  // 9. Trip lifecycle gate: completed trip returns 409
  const completedLive = await call(handleRiderLive, {
    method: 'POST',
    body: { tripId: 'trip-done', lat: 34.67, lng: -82.83, accuracy: 10 },
  }, { sb, user: { id: 'rider-live-1' } })
  assert.equal(completedLive.status, 409)
  assert.match(completedLive.json.error, /only on while this ride is booking/i)

  // 10. Valid streamable trip updates live GPS fix with 200
  const validLive = await call(handleRiderLive, {
    method: 'POST',
    body: { tripId: 'trip-booking', lat: 34.6795, lng: -82.8374, accuracy: 8, heading: 180 },
  }, { sb, user: { id: 'rider-live-1' }, opts: { now: () => new Date('2026-10-10T15:30:00Z') } })
  assert.equal(validLive.status, 200)
  assert.equal(validLive.json.ok, true)
  assert.equal(validLive.json.rider_location.lat, 34.6795)
  assert.equal(validLive.json.rider_location.lng, -82.8374)
  assert.equal(validLive.json.rider_location.accuracy_m, 8)
  assert.equal(validLive.json.rider_location.heading, 180)
})

// ---------------------------------------------------------------------------
// 17. TRIP SETTLE BOUNDS & TENANT ISOLATION TESTS
// ---------------------------------------------------------------------------

test('fare & settlement bounds: tripSettle validates method, auth, tenant boundaries, lifecycle gates, and authoritative balance', async () => {
  const sb = createFakeSb({
    trips: [
      { id: 'trip-active', rider_id: 'rider-1', driver_id: 'driver-1', status: 'in_progress', fare_cents: 3500 },
      { id: 'trip-wait-fee', rider_id: 'rider-1', driver_id: 'driver-1', status: 'in_progress', fare_cents: 3500, metadata: { wait_fee_cents: 500 } },
      { id: 'trip-completed', rider_id: 'rider-1', driver_id: 'driver-1', status: 'completed', fare_cents: 3500 },
      { id: 'trip-alien', rider_id: 'stranger-rider', driver_id: 'stranger-driver', status: 'in_progress', fare_cents: 3500 },
    ],
    payments: [],
    profiles: [
      { id: 'rider-1', email: 'rider1@clemson.edu', role: 'rider' },
      { id: 'driver-1', email: 'driver1@clemson.edu', role: 'driver' },
      { id: 'admin-user', email: 'admin@clemson.edu', role: 'admin' },
      { id: 'stranger', email: 'stranger@other.com', role: 'rider' },
    ],
  })

  // 1. Non-POST returns 405
  const getSettle = await call(handleTripSettle, { method: 'GET' }, { sb })
  assert.equal(getSettle.status, 405)

  // 2. Auth bounds: missing sb returns 503, missing user returns 401
  const noSbSettle = await call(handleTripSettle, { method: 'POST', body: { tripId: 'trip-active' } }, { sb: null })
  assert.equal(noSbSettle.status, 503)

  const unauthSettle = await call(handleTripSettle, { method: 'POST', body: { tripId: 'trip-active' } }, { sb, user: null })
  assert.equal(unauthSettle.status, 401)

  // 3. Missing tripId returns 400
  const noTripSettle = await call(handleTripSettle, { method: 'POST', body: {} }, { sb, user: { id: 'rider-1' } })
  assert.equal(noTripSettle.status, 400)
  assert.match(noTripSettle.json.error, /tripId required/i)

  // 4. Non-existent trip returns 404
  const notFoundSettle = await call(handleTripSettle, {
    method: 'POST',
    body: { tripId: 'trip-nonexistent' },
  }, { sb, user: { id: 'rider-1' } })
  assert.equal(notFoundSettle.status, 404)
  assert.match(notFoundSettle.json.error, /Trip not found/i)

  // 5. Cross-tenant caller (not rider, not driver, not admin) returns 403
  const alienSettle = await call(handleTripSettle, {
    method: 'POST',
    body: { tripId: 'trip-active' },
  }, { sb, user: { id: 'stranger' } })
  assert.equal(alienSettle.status, 403)
  assert.match(alienSettle.json.error, /Not allowed on this trip/i)

  // 6. Already completed trip returns 409 when action !== 'charge'
  const alreadyDoneSettle = await call(handleTripSettle, {
    method: 'POST',
    body: { tripId: 'trip-completed', action: 'complete' },
  }, { sb, user: { id: 'driver-1' } })
  assert.equal(alreadyDoneSettle.status, 409)
  assert.match(alreadyDoneSettle.json.error, /Trip already completed/i)

  // 7. Action 'charge' with unpaid fee when Stripe unconfigured returns 503
  const noStripeSettle = await call(handleTripSettle, {
    method: 'POST',
    body: { tripId: 'trip-wait-fee', action: 'charge', feeKind: 'wait_fee' },
  }, { sb, user: { id: 'driver-1' }, stripeOk: () => false, stripe: null })
  assert.equal(noStripeSettle.status, 503)
  assert.match(noStripeSettle.json.error, /Payments unavailable/i)

  // 8. Successful settlement invokes settleTrip with authoritative context
  let capturedSettleArgs = null
  const fakeSettleFn = async (args) => {
    capturedSettleArgs = args
    return { http: 200, body: { ok: true, tripId: args.trip.id, action: args.action } }
  }
  const validSettle = await call(handleTripSettle, {
    method: 'POST',
    body: { tripId: 'trip-active', action: 'complete', amountCents: 100 }, // client tries to inject $1 amount
  }, { sb, user: { id: 'driver-1' }, stripeOk: () => true, stripe: {}, settleTrip: fakeSettleFn })
  assert.equal(validSettle.status, 200)
  assert.equal(validSettle.json.ok, true)
  assert.equal(capturedSettleArgs.explicitAmountCents, null) // client money was stripped
})

// ---------------------------------------------------------------------------
// 18. CHECKOUT HARDENING: ABANDON AND RECONCILE CHECKOUT TESTS
// ---------------------------------------------------------------------------

test('checkout hardening: abandonCheckout and reconcileCheckout enforce security headers, session validity, and rider ownership', async () => {
  const sb = createFakeSb({
    trips: [
      { id: 'trip-chk-rider1', rider_id: 'rider-chk-1', status: 'searching', metadata: { stripe_checkout_session_id: 'cs_rider1' } },
      { id: 'trip-chk-alien', rider_id: 'alien-rider', status: 'searching', metadata: { stripe_checkout_session_id: 'cs_alien' } },
    ],
    payments: [],
  })

  // --- abandonCheckout tests ---
  // 1. Emits strict security headers
  const getAbandon = await call(handleAbandonCheckout, { method: 'GET' }, { sb })
  assert.equal(getAbandon.status, 405)
  assert.match(getAbandon.headers['Cache-Control'] || getAbandon.headers['cache-control'], /no-store, no-cache/i)
  assert.match(getAbandon.headers['Pragma'] || getAbandon.headers['pragma'], /no-cache/i)
  assert.match(getAbandon.headers['Allow'] || getAbandon.headers['allow'], /POST, OPTIONS/i)

  // 2. Auth bounds
  const noSbAbandon = await call(handleAbandonCheckout, { method: 'POST', body: { tripId: 'trip-chk-rider1' } }, { sb: null })
  assert.equal(noSbAbandon.status, 503)

  const unauthAbandon = await call(handleAbandonCheckout, { method: 'POST', body: { tripId: 'trip-chk-rider1' } }, { sb, user: null })
  assert.equal(unauthAbandon.status, 401)

  // 3. Missing tripId returns 400
  const noTripAbandon = await call(handleAbandonCheckout, { method: 'POST', body: {} }, { sb, user: { id: 'rider-chk-1' } })
  assert.equal(noTripAbandon.status, 400)
  assert.match(noTripAbandon.json.error, /tripId required/i)

  // 4. Cross-tenant trip ownership returns 404 (isolation)
  const alienTripAbandon = await call(handleAbandonCheckout, {
    method: 'POST',
    body: { tripId: 'trip-chk-alien' },
  }, { sb, user: { id: 'rider-chk-1' } })
  assert.equal(alienTripAbandon.status, 404)
  assert.match(alienTripAbandon.json.error, /Trip not found/i)

  // 5. Session mismatch returns 403
  const fakeStripe = {
    checkout: {
      sessions: {
        retrieve: async (id) => {
          if (id === 'cs_mismatch_trip') return { id, metadata: { tripId: 'different-trip', riderId: 'rider-chk-1' } }
          if (id === 'cs_mismatch_rider') return { id, metadata: { tripId: 'trip-chk-rider1', riderId: 'other-rider' } }
          return { id, metadata: { tripId: 'trip-chk-rider1', riderId: 'rider-chk-1' } }
        },
        expire: async (id) => ({ id, status: 'expired' }),
      },
    },
  }
  const mismatchTripAbandon = await call(handleAbandonCheckout, {
    method: 'POST',
    body: { tripId: 'trip-chk-rider1', sessionId: 'cs_mismatch_trip' },
  }, { sb, user: { id: 'rider-chk-1' }, stripeOk: () => true, stripe: fakeStripe })
  assert.equal(mismatchTripAbandon.status, 403)
  assert.match(mismatchTripAbandon.json.error, /Session does not match this trip/i)

  const mismatchRiderAbandon = await call(handleAbandonCheckout, {
    method: 'POST',
    body: { tripId: 'trip-chk-rider1', sessionId: 'cs_mismatch_rider' },
  }, { sb, user: { id: 'rider-chk-1' }, stripeOk: () => true, stripe: fakeStripe })
  assert.equal(mismatchRiderAbandon.status, 403)
  assert.match(mismatchRiderAbandon.json.error, /Not your checkout/i)

  // 6. Valid release returns 200
  const validAbandon = await call(handleAbandonCheckout, {
    method: 'POST',
    body: { tripId: 'trip-chk-rider1', sessionId: 'cs_rider1' },
  }, {
    sb,
    user: { id: 'rider-chk-1' },
    stripeOk: () => true,
    stripe: fakeStripe,
    releaseUnpaidCheckoutTrip: async () => ({ canceled: true }),
  })
  assert.equal(validAbandon.status, 200)
  assert.equal(validAbandon.json.ok, true)
  assert.equal(validAbandon.json.canceled, true)

  // --- reconcileCheckout tests ---
  // 7. Security headers and method bounds
  const getReconcile = await call(handleReconcileCheckout, { method: 'GET' }, { sb })
  assert.equal(getReconcile.status, 405)
  assert.match(getReconcile.headers['Cache-Control'] || getReconcile.headers['cache-control'], /no-store, no-cache/i)
  assert.match(getReconcile.headers['Allow'] || getReconcile.headers['allow'], /POST, OPTIONS/i)

  // 8. Auth bounds
  const unauthReconcile = await call(handleReconcileCheckout, {
    method: 'POST',
    body: { sessionId: 'cs_valid' },
  }, { sb, user: null, stripeOk: () => true, stripe: fakeStripe })
  assert.equal(unauthReconcile.status, 401)

  // 9. Missing sessionId returns 400
  const noSessionReconcile = await call(handleReconcileCheckout, {
    method: 'POST',
    body: {},
  }, { sb, user: { id: 'rider-chk-1' }, stripeOk: () => true, stripe: fakeStripe })
  assert.equal(noSessionReconcile.status, 400)
  assert.match(noSessionReconcile.json.error, /sessionId required/i)

  // 10. Malformed sessionId returns 400
  const badSessionReconcile = await call(handleReconcileCheckout, {
    method: 'POST',
    body: { sessionId: 'not_a_checkout_session' },
  }, {
    sb,
    user: { id: 'rider-chk-1' },
    stripeOk: () => true,
    stripe: fakeStripe,
    reconcileCheckoutSession: async () => ({ ok: false, error: 'invalid_session_id', status: 400 }),
  })
  assert.equal(badSessionReconcile.status, 400)
  assert.equal(badSessionReconcile.json.error, 'invalid_session_id')

  // 11. Valid reconciliation completes with 200
  const validReconcile = await call(handleReconcileCheckout, {
    method: 'POST',
    body: { sessionId: 'cs_rider1' },
  }, {
    sb,
    user: { id: 'rider-chk-1' },
    stripeOk: () => true,
    stripe: fakeStripe,
    reconcileCheckoutSession: async () => ({ ok: true, paid: true, tripId: 'trip-chk-rider1', status: 200 }),
  })
  assert.equal(validReconcile.status, 200)
  assert.equal(validReconcile.json.ok, true)
  assert.equal(validReconcile.json.paid, true)
})

// ---------------------------------------------------------------------------
// 19. CLEMSON VS MIAMI PROMO CHECKOUT BOUNDS TESTS
// ---------------------------------------------------------------------------

test('fare & promo bounds: clemsonMiamiCheckout enforces method, auth, promo time window, single-use per rider, and Stripe availability', async () => {
  const sb = createFakeSb({
    trips: [
      {
        id: 'trip-promo-used',
        rider_id: 'rider-repeat',
        status: 'searching',
        metadata: { promo: 'clemson-miami-2026-10-03', promo_ride: true },
      },
    ],
    profiles: [
      { id: 'rider-fresh', email: 'fresh@clemson.edu' },
      { id: 'rider-repeat', email: 'repeat@clemson.edu' },
    ],
  })

  const promoOpenDate = new Date(Date.UTC(2026, 9, 3, 16, 0, 0)) // Oct 3 2026, 12:00 PM EDT
  const promoClosedDate = new Date(Date.UTC(2026, 9, 4, 12, 0, 0)) // Oct 4 2026

  // 1. Non-POST returns 405 with security headers
  const getPromo = await call(handleClemsonMiamiCheckout, { method: 'GET' }, { sb })
  assert.equal(getPromo.status, 405)
  assert.match(getPromo.headers['Cache-Control'] || getPromo.headers['cache-control'], /no-store, no-cache/i)
  assert.match(getPromo.headers['Allow'] || getPromo.headers['allow'], /POST, OPTIONS/i)

  // 2. Auth bounds
  const noSbPromo = await call(handleClemsonMiamiCheckout, { method: 'POST' }, { sb: null, user: { id: 'rider-fresh' }, now: promoOpenDate })
  assert.equal(noSbPromo.status, 503)

  const unauthPromo = await call(handleClemsonMiamiCheckout, { method: 'POST' }, { sb, user: null, now: promoOpenDate })
  assert.equal(unauthPromo.status, 401)

  // 3. Promo window closed returns 403
  const closedPromo = await call(handleClemsonMiamiCheckout, {
    method: 'POST',
  }, { sb, user: { id: 'rider-fresh' }, now: promoClosedDate })
  assert.equal(closedPromo.status, 403)
  assert.equal(closedPromo.json.promoApplied, false)
  assert.match(closedPromo.json.error, /only available on October 3, 2026/i)

  // 4. Stripe unconfigured returns 503
  const noStripePromo = await call(handleClemsonMiamiCheckout, {
    method: 'POST',
  }, { sb, user: { id: 'rider-fresh' }, now: promoOpenDate, stripeOk: () => false })
  assert.equal(noStripePromo.status, 503)
  assert.match(noStripePromo.json.error, /Payments unavailable/i)

  // 5. Account already used the promo returns 409
  const repeatPromo = await call(handleClemsonMiamiCheckout, {
    method: 'POST',
  }, {
    sb,
    user: { id: 'rider-repeat' },
    now: promoOpenDate,
    stripeOk: () => true,
    ensureProfile: async () => ({ ok: true }),
  })
  assert.equal(repeatPromo.status, 409)
  assert.equal(repeatPromo.json.promoApplied, false)
  assert.match(repeatPromo.json.error, /already used the \$1 Clemson vs Miami ride/i)

  // 6. Valid checkout strips client money fields, enforces authoritative $1 fare, and creates session
  let capturedSessionParams = null
  const fakeStripe = {
    checkout: {
      sessions: {
        create: async (params) => {
          capturedSessionParams = params
          return { id: 'cs_promo_1', url: 'https://checkout.stripe.com/pay/cs_promo_1' }
        },
      },
    },
  }
  const validPromo = await call(handleClemsonMiamiCheckout, {
    method: 'POST',
    body: {
      fareCents: 5000, // client tampering
      depositCents: 2000,
      amount: 9999,
      isStudent: true,
    },
  }, {
    sb,
    user: { id: 'rider-fresh', email: 'fresh@clemson.edu' },
    now: promoOpenDate,
    stripeOk: () => true,
    stripe: fakeStripe,
    ensureProfile: async () => ({ ok: true }),
  })
  assert.equal(validPromo.status, 200)
  assert.equal(validPromo.json.promoApplied, true)
  assert.equal(validPromo.json.chargedCents, 100) // $1 authoritative
  assert.equal(capturedSessionParams.metadata.tripId, validPromo.json.tripId)
  assert.equal(capturedSessionParams.metadata.promo, 'clemson-miami-2026-10-03')
  assert.equal(capturedSessionParams.metadata.kind, 'promo_ride')
})

// ---------------------------------------------------------------------------
// 20. DRIVER APPLICANT INBOX & CARDS BOUNDS TESTS
// ---------------------------------------------------------------------------

test('driver inbox & card bounds: applicantInbox and driverCards enforce method, auth, character bounds, and onboarding approval projection', async () => {
  const approvedDriverId = '11111111-2222-4333-8444-555555555555'
  const pendingDriverId = '22222222-3333-4444-8555-666666666666'

  const sb = createFakeSb({
    profiles: [
      { id: 'app-user-1', email: 'applicant1@clemson.edu', full_name: 'Applicant One' },
      { id: approvedDriverId, full_name: 'Approved Driver', rating_avg: 4.88, rating_count: 50, standing: 'Top Driver' },
      { id: pendingDriverId, full_name: 'Pending Driver', rating_avg: 5.0, rating_count: 1, standing: 'New' },
    ],
    driver_applications: [
      { profile_id: approvedDriverId, onboarding_status: 'approved' },
      { profile_id: pendingDriverId, onboarding_status: 'pending' },
    ],
    vehicles: [
      { driver_id: approvedDriverId, color: 'Orange', make: 'Toyota', model: 'Camry', plate: 'TGR-101', tier: 'standard' },
      { driver_id: pendingDriverId, color: 'White', make: 'Ford', model: 'Focus', plate: 'TGR-102', tier: 'standard' },
    ],
    driver_application_messages: [],
    driver_info_requests: [
      { id: 'req-1', profile_id: 'app-user-1', status: 'open', prompt: 'Upload proof of insurance' },
    ],
    admin_notifications: [],
  })

  // --- applicantInbox tests ---
  // 1. Method bounds: DELETE returns 405
  const delInbox = await call(handleApplicantInbox, { method: 'DELETE' }, { sb })
  assert.equal(delInbox.status, 405)

  // 2. Auth bounds
  const noSbInbox = await call(handleApplicantInbox, { method: 'GET' }, { sb: null })
  assert.equal(noSbInbox.status, 503)

  const unauthInbox = await call(handleApplicantInbox, { method: 'GET' }, { sb, user: null })
  assert.equal(unauthInbox.status, 401)

  // 3. Empty message body returns 400
  const emptyBodyInbox = await call(handleApplicantInbox, {
    method: 'POST',
    body: { body: '   ' },
  }, { sb, user: { id: 'app-user-1' } })
  assert.equal(emptyBodyInbox.status, 400)
  assert.match(emptyBodyInbox.json.error, /1–4000 characters/i)

  // 4. Oversized message body (>4000 chars) returns 400
  const oversizedInbox = await call(handleApplicantInbox, {
    method: 'POST',
    body: { body: 'x'.repeat(4001) },
  }, { sb, user: { id: 'app-user-1' } })
  assert.equal(oversizedInbox.status, 400)
  assert.match(oversizedInbox.json.error, /1–4000 characters/i)

  // 5. Valid message posts, fulfills open requests, and logs notification
  const validInbox = await call(handleApplicantInbox, {
    method: 'POST',
    body: { body: 'Here is my updated document' },
  }, { sb, user: { id: 'app-user-1' } })
  assert.equal(validInbox.status, 200)
  assert.equal(validInbox.json.ok, true)
  assert.equal(validInbox.json.message.body, 'Here is my updated document')
  assert.equal(validInbox.json.message.author_role, 'applicant')

  // --- driverCards tests ---
  // 6. Non-POST returns 405
  const getCards = await call(handleDriverCards, { method: 'GET' }, { sb })
  assert.equal(getCards.status, 405)

  // 7. Missing sb returns 503
  const noSbCards = await call(handleDriverCards, { method: 'POST', body: { ids: [] } }, { sb: null })
  assert.equal(noSbCards.status, 503)

  // 8. Public driver cards only include approved drivers and protect private PII
  const cardsRes = await call(handleDriverCards, {
    method: 'POST',
    body: {
      ids: [
        approvedDriverId,
        pendingDriverId, // pending onboarding -> omitted
        'not-a-uuid-driver', // non-uuid -> dropped
      ],
    },
  }, { sb })
  assert.equal(cardsRes.status, 200)
  assert.equal(cardsRes.json.drivers.length, 1)
  const card = cardsRes.json.drivers[0]
  assert.equal(card.id, approvedDriverId)
  assert.equal(card.full_name, 'Approved Driver')
  assert.equal(card.make, 'Toyota')
  assert.equal(card.plate, 'TGR-101')
  // Private fields must never be exposed
  assert.equal(card.email, undefined)
  assert.equal(card.phone, undefined)
  assert.equal(card.tin, undefined)
})

test('scheduleTrip bounds: method, auth, pickup time lead, tier availability, place validation, backup bonus & boost validation, and authoritative fare ignores client tampering', async () => {
  const approvedDriverId = '11111111-2222-4333-8444-555555555555'
  const riderId = '22222222-3333-4444-8555-666666666666'
  const baseNow = new Date('2026-10-10T12:00:00.000Z')
  const futureTime = new Date(baseNow.getTime() + 60 * 60 * 1000).toISOString() // 1 hour ahead

  const sb = createFakeSb({
    profiles: [
      { id: riderId, full_name: 'Clemson Tiger', email: 'tiger@g.clemson.edu' },
      { id: approvedDriverId, full_name: 'Approved Driver', email: 'driver@clemson.edu' },
    ],
    driver_applications: [{ profile_id: approvedDriverId, onboarding_status: 'approved' }],
    vehicles: [{ driver_id: approvedDriverId, service_class: 'standard', tier: 'standard' }],
    driver_status: [{ driver_id: approvedDriverId, online: true }],
    trips: [],
    trip_events: [],
  })

  // 1. Non-POST returns 405
  const getRes = await call(handleScheduleTrip, { method: 'GET' }, { sb, now: baseNow.getTime() })
  assert.equal(getRes.status, 405)

  // 2. Missing sb returns 503
  const noSbRes = await call(handleScheduleTrip, { method: 'POST', body: {} }, { sb: null, user: { id: riderId } })
  assert.equal(noSbRes.status, 503)

  // 3. Unauthenticated rider returns 401
  const unauthRes = await call(handleScheduleTrip, { method: 'POST', body: {} }, { sb, user: null })
  assert.equal(unauthRes.status, 401)

  // 4. Invalid or unsupported tier returns 400
  const badTier = await call(handleScheduleTrip, {
    method: 'POST',
    body: { tier: 'hyperloop', pickupAt: futureTime },
  }, { sb, user: { id: riderId }, now: baseNow.getTime() })
  assert.equal(badTier.status, 400)
  assert.equal(badTier.json.code, 'ride_option_unavailable')

  // 5. Invalid pickup time (spring-forward gap hour) returns 400
  const badTime = await call(handleScheduleTrip, {
    method: 'POST',
    body: { date: '2026-03-08', time: '02:30' },
  }, { sb, user: { id: riderId }, now: baseNow.getTime() })
  assert.equal(badTime.status, 400)
  assert.match(badTime.json.error, /Choose a valid pickup time/i)

  // 6. Booking under 30 minutes in advance when not near-term returns 400
  const tooSoon = await call(handleScheduleTrip, {
    method: 'POST',
    body: {
      pickupAt: new Date(baseNow.getTime() + 15 * 60 * 1000).toISOString(), // 15 mins
      pickup: SIKES,
      dropoff: COOPER,
    },
  }, { sb, user: { id: riderId }, now: baseNow.getTime() })
  assert.equal(tooSoon.status, 400)
  assert.match(tooSoon.json.error, /Schedule at least 30 minutes ahead/i)

  // 7. Missing pickup or dropoff returns 400
  const missingPlaces = await call(handleScheduleTrip, {
    method: 'POST',
    body: {
      pickupAt: futureTime,
      pickup: SIKES,
      dropoff: null,
    },
  }, { sb, user: { id: riderId }, now: baseNow.getTime() })
  assert.equal(missingPlaces.status, 400)
  assert.match(missingPlaces.json.error, /Choose a pickup and a drop-off/i)

  // 8. Same pickup and dropoff label returns 400
  const samePlaces = await call(handleScheduleTrip, {
    method: 'POST',
    body: {
      pickupAt: futureTime,
      pickup: SIKES,
      dropoff: { label: SIKES.label, lat: SIKES.lat, lng: SIKES.lng },
    },
  }, { sb, user: { id: riderId }, now: baseNow.getTime() })
  assert.equal(samePlaces.status, 400)
  assert.match(samePlaces.json.error, /different places/i)

  // 9. Invalid backup bonus amount returns 400
  const badBackup = await call(handleScheduleTrip, {
    method: 'POST',
    body: {
      pickupAt: futureTime,
      pickup: SIKES,
      dropoff: COOPER,
      backupBonusCents: 500, // $5 is not allowed (only $10 or $15)
    },
  }, { sb, user: { id: riderId }, now: baseNow.getTime() })
  assert.equal(badBackup.status, 400)
  assert.equal(badBackup.json.code, 'backup_bonus_invalid')

  // 10. Invalid boost amount returns 400
  const badBoost = await call(handleScheduleTrip, {
    method: 'POST',
    body: {
      pickupAt: futureTime,
      pickup: SIKES,
      dropoff: COOPER,
      boostCents: -500,
    },
  }, { sb, user: { id: riderId }, now: baseNow.getTime() })
  assert.equal(badBoost.status, 400)
  assert.equal(badBoost.json.code, 'boost_invalid')

  // 11. Profile creation failure returns 500
  const profileFail = await call(handleScheduleTrip, {
    method: 'POST',
    body: {
      pickupAt: futureTime,
      pickup: SIKES,
      dropoff: COOPER,
    },
  }, { sb, user: { id: riderId }, now: baseNow.getTime(), ensureProfile: async () => ({ ok: false }) })
  assert.equal(profileFail.status, 500)
  assert.equal(profileFail.json.code, 'profile_missing')

  // 12. Valid scheduled trip: ignores client fare tampering, computes authoritative fare with schedule ahead discount
  const validTrip = await call(handleScheduleTrip, {
    method: 'POST',
    body: {
      pickupAt: futureTime,
      pickup: SIKES,
      dropoff: COOPER,
      fare_cents: 99, // tampered fare
      amount: 99,     // tampered amount
      backupBonusCents: 1000, // valid $10 backup
      boostCents: 500,        // valid $5 boost
    },
  }, { sb, user: { id: riderId, email: 'tiger@g.clemson.edu' }, now: baseNow.getTime() })
  assert.equal(validTrip.status, 200)
  assert.equal(validTrip.json.trip.status, 'scheduled')
  assert.equal(validTrip.json.trip.rider_id, riderId)
  assert.equal(validTrip.json.backupBonusCents, 1000)
  assert.equal(validTrip.json.backupBooked, true)
  assert.equal(validTrip.json.boostCents, 500)
  assert.equal(validTrip.json.scheduleDiscountApplied, true)
  assert.ok(validTrip.json.fareCents > 100, 'Authoritative fare computed instead of tampered 99 cents')
})

test('requestDriverTrip bounds: simulated driver rejection, driver approval gate, tier availability, auto-assign empty pool, comfort vehicle check, and authoritative fare & hold', async () => {
  const approvedDriverId = '11111111-2222-4333-8444-555555555555'
  const pendingDriverId = '22222222-3333-4444-8555-666666666666'
  const comfortDriverId = '44444444-5555-4666-8777-888888888888'
  const riderId = '33333333-4444-4555-8666-777777777777'

  const sb = createFakeSb({
    profiles: [
      { id: riderId, full_name: 'Rider Request', email: 'rider@clemson.edu' },
      { id: approvedDriverId, full_name: 'Approved Driver', email: 'driver@clemson.edu' },
      { id: pendingDriverId, full_name: 'Pending Driver', email: 'pending@clemson.edu' },
      { id: comfortDriverId, full_name: 'Comfort Driver', email: 'comfort@clemson.edu' },
    ],
    driver_applications: [
      { profile_id: approvedDriverId, onboarding_status: 'approved' },
      { profile_id: pendingDriverId, onboarding_status: 'pending' },
      { profile_id: comfortDriverId, onboarding_status: 'approved' },
    ],
    vehicles: [
      { driver_id: approvedDriverId, service_class: 'standard', tier: 'standard' },
      { driver_id: comfortDriverId, service_class: 'comfort', tier: 'comfort' },
    ],
    driver_status: [
      { driver_id: approvedDriverId, online: true },
      { driver_id: comfortDriverId, online: true },
    ],
    trips: [],
    trip_events: [],
  })

  // 1. Non-POST returns 405
  const getRes = await call(handleRequestDriverTrip, { method: 'GET' }, { sb })
  assert.equal(getRes.status, 405)

  // 2. Missing sb returns 503
  const noSb = await call(handleRequestDriverTrip, { method: 'POST', body: {} }, { sb: null, user: { id: riderId } })
  assert.equal(noSb.status, 503)

  // 3. Unauthenticated rider returns 401
  const unauth = await call(handleRequestDriverTrip, { method: 'POST', body: {} }, { sb, user: null })
  assert.equal(unauth.status, 401)

  // 4. Simulated preview car ID rejected with 409
  const simCar = await call(handleRequestDriverTrip, {
    method: 'POST',
    body: { driverId: 'demo-marcus' },
  }, { sb, user: { id: riderId } })
  assert.equal(simCar.status, 409)
  assert.equal(simCar.json.code, 'ride_option_unavailable')
  assert.match(simCar.json.error, /map preview and cannot be requested/i)

  // 5. Missing driver when autoAssign is false returns 400
  const noDriver = await call(handleRequestDriverTrip, {
    method: 'POST',
    body: { autoAssign: false },
  }, { sb, user: { id: riderId } })
  assert.equal(noDriver.status, 400)
  assert.match(noDriver.json.error, /Select a driver first/i)

  // 6. Requesting unapproved driver returns 403
  const unapproved = await call(handleRequestDriverTrip, {
    method: 'POST',
    body: {
      driverId: pendingDriverId,
      pickupLabel: SIKES.label,
      pickupLat: SIKES.lat,
      pickupLng: SIKES.lng,
      dropoffLabel: COOPER.label,
      dropoffLat: COOPER.lat,
      dropoffLng: COOPER.lng,
    },
  }, { sb, user: { id: riderId } })
  assert.equal(unapproved.status, 403)
  assert.equal(unapproved.json.code, 'driver_not_approved')

  // 7. Auto-assign when no drivers online returns 409
  const emptySb = createFakeSb({
    profiles: [{ id: riderId, full_name: 'Rider Request', email: 'rider@clemson.edu' }],
    driver_applications: [],
    driver_status: [],
    vehicles: [],
    trips: [],
  })
  const noOnline = await call(handleRequestDriverTrip, {
    method: 'POST',
    body: {
      autoAssign: true,
      pickupLabel: SIKES.label,
      pickupLat: SIKES.lat,
      pickupLng: SIKES.lng,
      dropoffLabel: COOPER.label,
      dropoffLat: COOPER.lat,
      dropoffLng: COOPER.lng,
    },
  }, { sb: emptySb, user: { id: riderId } })
  assert.equal(noOnline.status, 409)

  // 8. Extra Comfort requested for driver with standard-only vehicle returns 409
  const comfortMismatch = await call(handleRequestDriverTrip, {
    method: 'POST',
    body: {
      driverId: approvedDriverId,
      tier: 'comfort',
      pickupLabel: SIKES.label,
      pickupLat: SIKES.lat,
      pickupLng: SIKES.lng,
      dropoffLabel: COOPER.label,
      dropoffLat: COOPER.lat,
      dropoffLng: COOPER.lng,
    },
  }, { sb, user: { id: riderId } })
  assert.equal(comfortMismatch.status, 409)
  assert.match(comfortMismatch.json.error, /Extra Comfort/i)

  // 9. Valid driver trip request: strips client fare tampering, creates searching trip, authorizes fare hold
  const validReq = await call(handleRequestDriverTrip, {
    method: 'POST',
    body: {
      driverId: approvedDriverId,
      pickupLabel: SIKES.label,
      pickupLat: SIKES.lat,
      pickupLng: SIKES.lng,
      dropoffLabel: COOPER.label,
      dropoffLat: COOPER.lat,
      dropoffLng: COOPER.lng,
      fare_cents: 50, // client tamper
      amount: 50,     // client tamper
    },
  }, { sb, user: { id: riderId, email: 'rider@clemson.edu' } })
  assert.equal(validReq.status, 200)
  assert.equal(validReq.json.trip.status, 'searching')
  assert.equal(validReq.json.trip.driver_id, null)
  assert.ok(validReq.json.fareCents > 50, 'Authoritative fare calculated')
  assert.ok(validReq.json.authorization != null)
})

test('driverOfferDesk bounds: mark-offered and pass-offer validate auth, driver approval, online presence, trip ownership, and retargeting queue', async () => {
  const driverA = '11111111-2222-4333-8444-555555555555'
  const driverB = '22222222-3333-4444-8555-666666666666'
  const unapprovedDriver = '33333333-4444-4555-8666-777777777777'
  const riderId = '44444444-5555-4666-8777-888888888888'

  const sb = createFakeSb({
    profiles: [
      { id: driverA, full_name: 'Driver A', email: 'a@clemson.edu' },
      { id: driverB, full_name: 'Driver B', email: 'b@clemson.edu' },
      { id: unapprovedDriver, full_name: 'Driver C', email: 'c@clemson.edu' },
    ],
    driver_applications: [
      { profile_id: driverA, onboarding_status: 'approved' },
      { profile_id: driverB, onboarding_status: 'approved' },
      { profile_id: unapprovedDriver, onboarding_status: 'submitted' },
    ],
    vehicles: [
      { driver_id: driverA, service_class: 'standard', tier: 'standard' },
      { driver_id: driverB, service_class: 'standard', tier: 'standard' },
    ],
    driver_status: [
      { driver_id: driverA, online: true },
      { driver_id: driverB, online: true },
    ],
    trips: [
      {
        id: 'trip-offered-target',
        rider_id: riderId,
        driver_id: null,
        status: 'searching',
        metadata: { offer_driver_id: driverA },
      },
      {
        id: 'trip-for-driver-b',
        rider_id: riderId,
        driver_id: null,
        status: 'searching',
        metadata: { offer_driver_id: driverB },
      },
      {
        id: 'trip-auto-queue',
        rider_id: riderId,
        driver_id: null,
        status: 'searching',
        metadata: {
          match: 'auto',
          offer_driver_id: driverA,
          auto_assign_queue: [driverA, driverB],
        },
      },
    ],
    driver_offer_passes: [],
  })

  // --- handleMarkOffered ---
  // 1. Non-POST returns 405
  const getOffer = await call(handleMarkOffered, { method: 'GET' }, { sb })
  assert.equal(getOffer.status, 405)

  // 2. Unauthenticated returns 401
  const unauthOffer = await call(handleMarkOffered, { method: 'POST', body: { tripId: 'trip-offered-target' } }, { sb, user: null })
  assert.equal(unauthOffer.status, 401)

  // 3. Missing tripId returns 400
  const noTrip = await call(handleMarkOffered, { method: 'POST', body: {} }, { sb, user: { id: driverA } })
  assert.equal(noTrip.status, 400)

  // 4. Unapproved driver returns 403
  const unapproved = await call(handleMarkOffered, {
    method: 'POST',
    body: { tripId: 'trip-offered-target' },
  }, { sb, user: { id: unapprovedDriver } })
  assert.equal(unapproved.status, 403)
  assert.equal(unapproved.json.code, 'driver_not_approved')

  // 5. Offline driver returns 409
  const offlineSb = createFakeSb({
    driver_applications: [{ profile_id: driverA, onboarding_status: 'approved' }],
    driver_status: [{ driver_id: driverA, online: false }],
  })
  const offline = await call(handleMarkOffered, {
    method: 'POST',
    body: { tripId: 'trip-offered-target' },
  }, { sb: offlineSb, user: { id: driverA } })
  assert.equal(offline.status, 409)
  assert.equal(offline.json.code, 'driver_offline')

  // 6. Offer targeted to driver B called by driver A returns 403
  const wrongDriver = await call(handleMarkOffered, {
    method: 'POST',
    body: { tripId: 'trip-for-driver-b' },
  }, { sb, user: { id: driverA } })
  assert.equal(wrongDriver.status, 403)
  assert.equal(wrongDriver.json.code, 'offer_not_yours')

  // 7. Offer targeted to driver A called by driver A updates status to offered
  const validMark = await call(handleMarkOffered, {
    method: 'POST',
    body: { tripId: 'trip-offered-target' },
  }, { sb, user: { id: driverA } })
  assert.equal(validMark.status, 200)
  assert.equal(validMark.json.status, 'offered')

  // --- handlePassOffer ---
  // 8. Passing an offer targeted to another driver returns 403
  const passWrong = await call(handlePassOffer, {
    method: 'POST',
    body: { tripId: 'trip-for-driver-b' },
  }, { sb, user: { id: driverA } })
  assert.equal(passWrong.status, 403)
  assert.equal(passWrong.json.code, 'offer_not_yours')

  // 9. Passing an auto-assign offer advances the queue to next driver (driver B)
  const passAuto = await call(handlePassOffer, {
    method: 'POST',
    body: { tripId: 'trip-auto-queue' },
  }, { sb, user: { id: driverA } })
  assert.equal(passAuto.status, 200)
  assert.equal(passAuto.json.offerDriverId, driverB)
  assert.equal(passAuto.json.released, false)
})

test('carpool API bounds: action routing, program first-ride vs ambassador, attribution self-referral rejection, and inactive link handling', async () => {
  const ambassadorId = '11111111-2222-4333-8444-555555555555'
  const riderId = '22222222-3333-4444-8555-666666666666'

  const sb = createFakeSb({
    profiles: [
      { id: ambassadorId, full_name: 'Ambassador Sam', email: 'sam@clemson.edu' },
      { id: riderId, full_name: 'Rider Jane', email: 'jane@clemson.edu' },
    ],
    ambassador_codes: [
      { code: 'sam10', code_type: 'ambassador', profile_id: ambassadorId },
    ],
    ambassador_attributions: [],
    first_ride_grants: [],
    trips: [],
  })

  // 1. Unknown action returns 400
  const badAction = await call(carpoolHandler, {
    method: 'POST',
    url: '/api/carpool?action=invalid_action',
  }, { sb, user: { id: riderId } })
  assert.equal(badAction.status, 400)
  assert.match(badAction.json.error, /Unknown carpool action/i)

  // 2. Attribute own link returns 409
  const ownLink = await call(carpoolHandler, {
    method: 'POST',
    url: '/api/carpool?action=attribute',
    body: { code: 'sam10' },
  }, { sb, user: { id: ambassadorId } })
  assert.equal(ownLink.status, 409)
  assert.equal(ownLink.json.code, 'own_link')

  // 3. Attribute inactive/unknown code returns 404
  const unknownLink = await call(carpoolHandler, {
    method: 'POST',
    url: '/api/carpool?action=attribute',
    body: { code: 'unknown99' },
  }, { sb, user: { id: riderId } })
  assert.equal(unknownLink.status, 404)
  assert.match(unknownLink.json.error, /not active/i)

  // 4. Attribute valid code returns 200
  const validAttr = await call(carpoolHandler, {
    method: 'POST',
    url: '/api/carpool?action=attribute',
    body: { code: 'sam10' },
  }, { sb, user: { id: riderId } })
  assert.equal(validAttr.status, 200)
  assert.equal(validAttr.json.ok, true)

  // 5. Program first_ride checks eligibility
  const firstRide = await call(carpoolHandler, {
    method: 'POST',
    url: '/api/carpool?action=program',
    body: { action: 'first_ride' },
  }, { sb, user: { id: riderId } })
  assert.equal(firstRide.status, 200)
  assert.equal(firstRide.json.ok, true)
  assert.equal(firstRide.json.code_type, 'first_ride')
  assert.equal(firstRide.json.completedTrips, 0)
  assert.equal(firstRide.json.alreadyUsed, false)
})

test('riderSwitch bounds: method, auth, trip presence, tenant isolation, invalid action, and preview quote', async () => {
  const riderA = '11111111-2222-4333-8444-555555555555'
  const riderB = '22222222-3333-4444-8555-666666666666'
  const driverId = '33333333-4444-4555-8666-777777777777'

  const sb = createFakeSb({
    profiles: [
      { id: riderA, full_name: 'Rider A', email: 'a@clemson.edu' },
      { id: riderB, full_name: 'Rider B', email: 'b@clemson.edu' },
      { id: driverId, full_name: 'Driver Dave', email: 'd@clemson.edu' },
    ],
    trips: [
      {
        id: 'trip-switch-target',
        rider_id: riderA,
        driver_id: driverId,
        status: 'accepted',
        tier: 'standard',
        fare_cents: 2500,
        pickup_label: SIKES.label,
        pickup_lat: SIKES.lat,
        pickup_lng: SIKES.lng,
        dropoff_label: COOPER.label,
        dropoff_lat: COOPER.lat,
        dropoff_lng: COOPER.lng,
      },
    ],
    driver_applications: [{ profile_id: driverId, onboarding_status: 'approved' }],
    driver_status: [{ driver_id: driverId, online: true }],
    vehicles: [{ driver_id: driverId, service_class: 'standard', tier: 'standard' }],
  })

  // 1. Non-POST returns 405
  const getRes = await call(handleRiderSwitch, { method: 'GET' }, { sb })
  assert.equal(getRes.status, 405)

  // 2. Missing sb returns 503
  const noSb = await call(handleRiderSwitch, { method: 'POST', body: {} }, { sb: null, user: { id: riderA } })
  assert.equal(noSb.status, 503)

  // 3. Unauthenticated rider returns 401
  const unauth = await call(handleRiderSwitch, { method: 'POST', body: {} }, { sb, user: null })
  assert.equal(unauth.status, 401)

  // 4. Missing tripId returns 400
  const noTrip = await call(handleRiderSwitch, { method: 'POST', body: {} }, { sb, user: { id: riderA } })
  assert.equal(noTrip.status, 400)
  assert.equal(noTrip.json.code, 'trip_required')

  // 5. Non-existent trip returns 404
  const badTrip = await call(handleRiderSwitch, {
    method: 'POST',
    body: { tripId: 'trip-does-not-exist' },
  }, { sb, user: { id: riderA } })
  assert.equal(badTrip.status, 404)
  assert.equal(badTrip.json.code, 'trip_missing')

  // 6. Cross-account attempt returns 403
  const alienTrip = await call(handleRiderSwitch, {
    method: 'POST',
    body: { tripId: 'trip-switch-target' },
  }, { sb, user: { id: riderB } })
  assert.equal(alienTrip.status, 403)
  assert.equal(alienTrip.json.code, 'not_rider')

  // 7. Invalid action when confirm is true returns 400
  const badAction = await call(handleRiderSwitch, {
    method: 'POST',
    body: { tripId: 'trip-switch-target', confirm: true, action: 'teleport' },
  }, { sb, user: { id: riderA } })
  assert.equal(badAction.status, 400)
  assert.equal(badAction.json.code, 'rider_switch_action')

  // 8. Preview mode returns 200 with quote, available tiers, and pool line
  const preview = await call(handleRiderSwitch, {
    method: 'POST',
    body: { tripId: 'trip-switch-target', confirm: false },
  }, { sb, user: { id: riderA } })
  assert.equal(preview.status, 200)
  assert.ok(preview.json.quote != null)
  assert.ok(Array.isArray(preview.json.tiers))
})

test('tripMessages bounds: method, action, auth, counterpart access verification, and notifications', async () => {
  const riderId = '11111111-2222-4333-8444-555555555555'
  const driverId = '22222222-3333-4444-8555-666666666666'
  const strangerId = '33333333-4444-4555-8666-777777777777'

  const sb = createFakeSb({
    trips: [
      {
        id: 'trip-chat-1',
        rider_id: riderId,
        driver_id: driverId,
        status: 'accepted',
      },
    ],
    trip_messages: [
      {
        id: 'msg-valid-1',
        trip_id: 'trip-chat-1',
        sender_id: riderId,
        body: 'I am waiting by the curb',
      },
    ],
    driver_status: [{ driver_id: driverId, expo_push_token: 'ExponentPushToken[driver-test]' }],
    profiles: [
      { id: riderId, email: 'rider@clemson.edu' },
      { id: driverId, email: 'driver@clemson.edu' },
    ],
  })

  // 1. Non-POST returns 405
  const getRes = await call(handleTripMessages, { method: 'GET' }, { sb })
  assert.equal(getRes.status, 405)

  // 2. Invalid action returns 400
  const badAction = await call(handleTripMessages, {
    method: 'POST',
    url: '/api/trip-messages?action=unsupported',
  }, { sb, user: { id: riderId } })
  assert.equal(badAction.status, 400)
  assert.match(badAction.json.error, /action=message or action=lost-item/i)

  // 3. Missing sb returns 503
  const noSb = await call(handleTripMessages, {
    method: 'POST',
    url: '/api/trip-messages?action=message',
    body: {},
  }, { sb: null, user: { id: riderId } })
  assert.equal(noSb.status, 503)

  // 4. Unauthenticated returns 401
  const unauth = await call(handleTripMessages, {
    method: 'POST',
    url: '/api/trip-messages?action=message',
    body: {},
  }, { sb, user: null })
  assert.equal(unauth.status, 401)

  // 5. Caller is neither rider nor driver on the trip returns 403
  const stranger = await call(handleTripMessages, {
    method: 'POST',
    url: '/api/trip-messages?action=message',
    body: { tripId: 'trip-chat-1', messageId: 'msg-valid-1' },
  }, { sb, user: { id: strangerId } })
  assert.equal(stranger.status, 403)
  assert.match(stranger.json.error, /Could not notify/i)

  // 6. Missing messageId or unverified message returns 403
  const unverified = await call(handleTripMessages, {
    method: 'POST',
    url: '/api/trip-messages?action=message',
    body: { tripId: 'trip-chat-1', messageId: 'msg-spoofed-not-in-db' },
  }, { sb, user: { id: riderId } })
  assert.equal(unverified.status, 403)
  assert.match(unverified.json.error, /Could not notify/i)

  // 7. Verified counterpart message notification returns 200
  const validMsg = await call(handleTripMessages, {
    method: 'POST',
    url: '/api/trip-messages?action=message',
    body: { tripId: 'trip-chat-1', messageId: 'msg-valid-1' },
  }, { sb, user: { id: riderId } })
  assert.equal(validMsg.status, 200)
  assert.equal(validMsg.json.ok, true)
})

test('tigerHeat and friendRides bounds: methods, HEAD support, window queries, and action routing', async () => {
  const sb = createFakeSb({
    trips: [],
  })

  // --- tigerHeat tests ---
  // 1. Non-GET/HEAD returns 405
  const postHeat = await call(handleTigerHeat, { method: 'POST' }, { sb })
  assert.equal(postHeat.status, 405)

  // 2. HEAD returns 200 with empty body
  const headHeat = await call(handleTigerHeat, { method: 'HEAD', url: '/api/tiger-heat?window=now' }, { sb })
  assert.equal(headHeat.status, 200)
  assert.equal(headHeat.body, '')

  // 3. GET returns 200 with zones, solvency, and duration policy
  const getHeat = await call(handleTigerHeat, { method: 'GET', url: '/api/tiger-heat?window=weekday_am' }, { sb })
  assert.equal(getHeat.status, 200)
  assert.equal(getHeat.json.label, 'Tiger Heat Map')
  assert.equal(getHeat.json.windowId, 'weekday_am')
  assert.ok(Array.isArray(getHeat.json.zones))
  assert.ok(getHeat.json.solvency != null)
  assert.ok(getHeat.json.durationPolicy != null)

  // --- friendRides tests ---
  // 4. Unknown action returns 400
  const badAction = await call(handleFriendRides, {
    method: 'POST',
    url: '/api/friend-rides?action=unknown_action',
  }, { sb })
  assert.equal(badAction.status, 400)
  assert.match(badAction.json.error, /Unknown friend ride action/i)

  // 5. Non-POST on create returns 405
  const getCreate = await call(handleFriendRides, {
    method: 'GET',
    url: '/api/friend-rides?action=create',
  }, { sb })
  assert.equal(getCreate.status, 405)

  // 6. Unauthenticated on create returns 401
  const unauthCreate = await call(handleFriendRides, {
    method: 'POST',
    url: '/api/friend-rides?action=create',
    body: {},
  }, { sb, user: null })
  assert.equal(unauthCreate.status, 401)
})


