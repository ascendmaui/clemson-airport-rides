import assert from 'node:assert/strict'
import test, { describe, beforeEach, afterEach, mock } from 'node:test'
import { register } from 'node:module'
import scheduleTripHandler from './endpoints/scheduleTrip.js'

// src/lib/scheduledRides.js is a Vite module (extensionless imports, browser
// Supabase client). The loader resolves it under Node and swaps in the mock
// client, so the tests below exercise the REAL takeReminder, not a copy.
register('../tests/fixtures/srcLibLoader.mjs', import.meta.url)
const { takeReminder } = await import('../src/lib/scheduledRides.js')

// The handler rejects pickups less than 30 minutes ahead of Date.now(), and many
// tests use fixed calendar dates (Fri 2026-10-02, DST 2026-11-01, ...). Freeze the
// clock at Mon 2026-09-21 12:00 EDT so those dates stay in the future forever
// instead of the suite starting to fail once they pass.
const FROZEN_NOW = new Date('2026-09-21T16:00:00.000Z')

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      this.body = payload == null ? '' : String(payload)
    },
  }
}

async function callHandler(handler, req, deps) {
  const res = mockRes()
  await handler({ headers: {}, ...req }, res, deps)
  let json = null
  try {
    json = res.body ? JSON.parse(res.body) : null
  } catch {
    json = null
  }
  return { status: res.statusCode, json }
}

function createFakeSb({
  gameDayEvents = [],
  tripInsertError = null,
  tripEventInsertError = null,
} = {}) {
  const tripsInserted = []
  const tripEventsInserted = []
  const operations = []

  const sb = {
    tripsInserted,
    tripEventsInserted,
    operations,
    from(table) {
      operations.push({ op: 'from', table })
      let currentFilterIso = null

      const chain = {
        select(cols) {
          operations.push({ op: 'select', table, cols })
          return chain
        },
        eq(col, val) {
          operations.push({ op: 'eq', table, col, val })
          return chain
        },
        lte(col, val) {
          operations.push({ op: 'lte', table, col, val })
          currentFilterIso = val
          return chain
        },
        gte(col, val) {
          operations.push({ op: 'gte', table, col, val })
          return chain
        },
        order(col, opts) {
          operations.push({ op: 'order', table, col, opts })
          return chain
        },
        limit(num) {
          operations.push({ op: 'limit', table, num })
          if (table === 'game_day_events') {
            return Promise.resolve({
              data: Array.isArray(gameDayEvents) ? gameDayEvents : [],
              error: null,
            })
          }
          return chain
        },
        async single() {
          operations.push({ op: 'single', table })
          if (table === 'trips') {
            if (tripInsertError) {
              return { data: null, error: tripInsertError }
            }
            const lastTrip = tripsInserted[tripsInserted.length - 1]
            return {
              data: {
                id: lastTrip?.id || 'trip_test_123',
                status: lastTrip?.status || 'scheduled',
                pickup_at: lastTrip?.pickup_at || null,
                pickup_label: lastTrip?.pickup_label || 'Memorial Stadium',
                dropoff_label: lastTrip?.dropoff_label || 'Downtown Clemson',
                fare_cents: lastTrip?.fare_cents || 2500,
                deposit_cents: lastTrip?.deposit_cents || 625,
              },
              error: null,
            }
          }
          return { data: null, error: null }
        },
        insert(payload) {
          operations.push({ op: 'insert', table, payload })
          if (table === 'trips') {
            if (tripInsertError) {
              // will be returned when single() is called or directly
              tripsInserted.push({ ...payload })
              return chain
            }
            const trip = { id: `trip_${Math.random().toString(36).slice(2, 9)}`, ...payload }
            tripsInserted.push(trip)
            return chain
          }
          if (table === 'trip_events') {
            if (tripEventInsertError) {
              return Promise.resolve({ data: null, error: tripEventInsertError })
            }
            tripEventsInserted.push(payload)
            return Promise.resolve({ data: payload, error: null })
          }
          return chain
        },
      }
      return chain
    },
  }

  return { sb, tripsInserted, tripEventsInserted, operations }
}

const mockStandardUser = {
  id: 'user_regular_001',
  email: 'visitor@gmail.com',
  user_metadata: { full_name: 'Regular Rider' },
}

const mockStudentUser = {
  id: 'user_student_002',
  email: 'student@clemson.edu',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  user_metadata: { full_name: 'Clemson Tiger' },
}

const defaultPlaces = {
  pickup: { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 },
  dropoff: { label: 'Downtown Clemson', lat: 34.6834, lng: -82.8374 },
}

describe('scheduleTrip endpoint handler', () => {
  let originalFetch

  beforeEach(() => {
    mock.timers.enable({ apis: ['Date'], now: FROZEN_NOW })
    originalFetch = globalThis.fetch
    // Disallow external network; return deterministic offline route fallback error
    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: 'offline test fake' } }),
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    mock.timers.reset()
  })

  describe('HTTP method and CORS', () => {
    test('rejects GET method with 405 Method not allowed', async () => {
      const { sb } = createFakeSb()
      const res = await callHandler(
        scheduleTripHandler,
        { method: 'GET' },
        { user: mockStandardUser, sb },
      )
      assert.equal(res.status, 405)
      assert.deepEqual(res.json, { error: 'Method not allowed' })
    })

    test('rejects PUT and DELETE methods with 405 Method not allowed', async () => {
      const { sb } = createFakeSb()
      for (const method of ['PUT', 'DELETE', 'PATCH']) {
        const res = await callHandler(
          scheduleTripHandler,
          { method },
          { user: mockStandardUser, sb },
        )
        assert.equal(res.status, 405)
        assert.deepEqual(res.json, { error: 'Method not allowed' })
      }
    })

    test('responds to OPTIONS preflight with 204 No Content via cors', async () => {
      const mock = mockRes()
      await scheduleTripHandler({ method: 'OPTIONS', headers: {} }, mock, {})
      assert.equal(mock.statusCode, 204)
    })
  })

  describe('Authentication and Supabase configuration', () => {
    test('returns 503 when Supabase client is missing', async () => {
      const res = await callHandler(
        scheduleTripHandler,
        { method: 'POST', body: {} },
        { user: mockStandardUser, sb: null },
      )
      assert.equal(res.status, 503)
      assert.deepEqual(res.json, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
    })

    test('returns 401 when user is not authenticated', async () => {
      const { sb } = createFakeSb()
      const res = await callHandler(
        scheduleTripHandler,
        { method: 'POST', body: {} },
        { user: null, sb },
      )
      assert.equal(res.status, 401)
      assert.deepEqual(res.json, { error: 'Sign in required' })
    })

    test('returns 500 when ensureProfile fails', async () => {
      const { sb } = createFakeSb()
      const futureDate = new Date(Date.now() + 2 * 3600 * 1000).toISOString()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: futureDate,
          },
        },
        {
          user: mockStandardUser,
          sb,
          ensureProfile: async () => ({ ok: false }),
        },
      )
      assert.equal(res.status, 500)
      assert.deepEqual(res.json, {
        error: 'Could not create your rider profile',
        code: 'profile_missing',
      })
    })
  })

  describe('Request body and place validation', () => {
    test('returns 400 for malformed JSON string body', async () => {
      const { sb } = createFakeSb()
      const res = await callHandler(
        scheduleTripHandler,
        { method: 'POST', body: '{ invalid json' },
        { user: mockStandardUser, sb },
      )
      assert.equal(res.status, 400)
      assert.deepEqual(res.json, { error: 'Invalid JSON' })
    })

    test('returns 400 when pickup is missing or empty', async () => {
      const { sb } = createFakeSb()
      const futureDate = new Date(Date.now() + 2 * 3600 * 1000).toISOString()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            dropoff: defaultPlaces.dropoff,
            pickupAt: futureDate,
          },
        },
        { user: mockStandardUser, sb },
      )
      assert.equal(res.status, 400)
      assert.deepEqual(res.json, { error: 'Choose a pickup and a drop-off.' })
    })

    test('returns 400 when dropoff is missing or empty', async () => {
      const { sb } = createFakeSb()
      const futureDate = new Date(Date.now() + 2 * 3600 * 1000).toISOString()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            pickup: defaultPlaces.pickup,
            pickupAt: futureDate,
          },
        },
        { user: mockStandardUser, sb },
      )
      assert.equal(res.status, 400)
      assert.deepEqual(res.json, { error: 'Choose a pickup and a drop-off.' })
    })

    test('returns 400 when place coordinates are non-numeric or invalid', async () => {
      const { sb } = createFakeSb()
      const futureDate = new Date(Date.now() + 2 * 3600 * 1000).toISOString()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            pickup: { label: 'Stadium', lat: 'invalid', lng: -82.843 },
            dropoff: defaultPlaces.dropoff,
            pickupAt: futureDate,
          },
        },
        { user: mockStandardUser, sb },
      )
      assert.equal(res.status, 400)
      assert.deepEqual(res.json, { error: 'Choose a pickup and a drop-off.' })
    })

    test('returns 400 when pickup and dropoff labels are identical', async () => {
      const { sb } = createFakeSb()
      const futureDate = new Date(Date.now() + 2 * 3600 * 1000).toISOString()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            pickup: { label: 'Library', lat: 34.68, lng: -82.83 },
            dropoff: { label: 'Library', lat: 34.685, lng: -82.835 },
            pickupAt: futureDate,
          },
        },
        { user: mockStandardUser, sb },
      )
      assert.equal(res.status, 400)
      assert.deepEqual(res.json, { error: 'Pickup and drop-off need to be different places.' })
    })
  })

  describe('Pickup time validation (past, minimum lead time, far future)', () => {
    test('rejects pickup time in the past (< Date.now()) with 400', async () => {
      const { sb } = createFakeSb()
      const pastTime = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: pastTime,
          },
        },
        { user: mockStandardUser, sb },
      )
      assert.equal(res.status, 400)
      assert.deepEqual(res.json, { error: 'Schedule at least 30 minutes ahead.' })
    })

    test('rejects pickup time with less than 30 minutes lead time (e.g. 10m, 29m ahead)', async () => {
      const { sb } = createFakeSb()
      for (const minutesAhead of [5, 15, 29]) {
        const soonTime = new Date(Date.now() + minutesAhead * 60 * 1000).toISOString()
        const res = await callHandler(
          scheduleTripHandler,
          {
            method: 'POST',
            body: {
              ...defaultPlaces,
              pickupAt: soonTime,
            },
          },
          { user: mockStandardUser, sb },
        )
        assert.equal(res.status, 400)
        assert.deepEqual(res.json, { error: 'Schedule at least 30 minutes ahead.' })
      }
    })

    test('accepts pickup time with sufficient lead time (e.g. 45m ahead)', async () => {
      const { sb, tripsInserted } = createFakeSb()
      const validFuture = new Date(Date.now() + 45 * 60 * 1000).toISOString()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: validFuture,
            purpose: 'planned',
          },
        },
        {
          user: mockStandardUser,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )
      assert.equal(res.status, 200)
      assert.equal(res.json.trip.status, 'scheduled')
      assert.equal(tripsInserted.length, 1)
      assert.equal(tripsInserted[0].status, 'scheduled')
      assert.equal(tripsInserted[0].passengers, 1)
    })

    test('accepts far future pickup time (e.g. years ahead)', async () => {
      const { sb, tripsInserted } = createFakeSb()
      const farFutureIso = '2028-10-15T14:30:00.000Z'
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: farFutureIso,
            purpose: 'planned',
          },
        },
        {
          user: mockStandardUser,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )
      assert.equal(res.status, 200)
      assert.equal(tripsInserted.length, 1)
      assert.equal(tripsInserted[0].pickup_at, farFutureIso)
      assert.equal(tripsInserted[0].scheduled_for, farFutureIso)
    })

    test('supports date + time format (YYYY-MM-DD + HH:MM)', async () => {
      const { sb, tripsInserted } = createFakeSb()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            date: '2027-05-20',
            time: '14:00',
            purpose: 'early_class',
          },
        },
        {
          user: mockStandardUser,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )
      assert.equal(res.status, 200)
      assert.equal(tripsInserted.length, 1)
      // 14:00 America/New_York on 2027-05-20 is EDT (UTC-4) → 18:00Z
      assert.equal(tripsInserted[0].pickup_at, '2027-05-20T18:00:00.000Z')
    })

    // Fixed: date+time is America/New_York wall clock, not host TZ (Vercel UTC used to shift surge).
    test('date + time is America/New_York wall time even when process TZ is UTC', async () => {
      const prevTz = process.env.TZ
      process.env.TZ = 'UTC'
      try {
        const { sb, tripsInserted } = createFakeSb()
        const res = await callHandler(
          scheduleTripHandler,
          { method: 'POST', body: { ...defaultPlaces, date: '2027-05-20', time: '14:00' } },
          { user: mockStandardUser, sb, ensureProfile: async () => ({ ok: true }) },
        )
        assert.equal(res.status, 200)
        assert.equal(tripsInserted[0].pickup_at, '2027-05-20T18:00:00.000Z') // 2 PM EDT
      } finally {
        if (prevTz === undefined) delete process.env.TZ
        else process.env.TZ = prevTz
      }
    })
  })

  describe('Friday 23:59 -> Saturday rollover and weekend surge', () => {
    test('applies weekend surge on Friday at 23:59:00 EDT', async () => {
      const { sb, tripsInserted } = createFakeSb()
      // 2026-10-02 is a Friday. 23:59 EDT is 2026-10-03T03:59:00Z.
      const fridayNightIso = '2026-10-03T03:59:00.000Z'
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: fridayNightIso,
            purpose: 'party_weekend',
          },
        },
        {
          user: mockStandardUser,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )
      assert.equal(res.status, 200)
      assert.equal(tripsInserted.length, 1)
      // Weekend surge rule provides multiplier 1.2
      assert.equal(tripsInserted[0].surge_multiplier, 1.2)
      assert.equal(tripsInserted[0].metadata.party, 'weekend')
      assert.equal(tripsInserted[0].metadata.purpose, 'party_weekend')
    })

    test('preserves weekend surge after Friday rollover to Saturday 00:05:00 EDT', async () => {
      const { sb, tripsInserted } = createFakeSb()
      // Saturday 00:05 EDT is 2026-10-03T04:05:00Z.
      const saturdayNightIso = '2026-10-03T04:05:00.000Z'
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: saturdayNightIso,
            purpose: 'party_weekend',
          },
        },
        {
          user: mockStandardUser,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )
      assert.equal(res.status, 200)
      assert.equal(tripsInserted.length, 1)
      assert.equal(tripsInserted[0].surge_multiplier, 1.2)
      assert.equal(tripsInserted[0].metadata.party, 'weekend')
    })
  })

  describe('Weekend game-day multiplier via fake database rows', () => {
    test('applies game-day multiplier from game_day_events table to fare and trip record', async () => {
      const gameDayEvent = {
        id: 'gde-001',
        title: 'Clemson vs Rival Football Game',
        surge_multiplier: 2.1,
        pickup_zone_label: 'Memorial Stadium Zone',
      }
      const { sb, tripsInserted } = createFakeSb({
        gameDayEvents: [gameDayEvent],
      })

      // Saturday afternoon game window: 2026-10-03T18:00:00Z (2:00 PM EDT)
      const gameTimeIso = '2026-10-03T18:00:00.000Z'
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: gameTimeIso,
            purpose: 'planned',
          },
        },
        {
          user: mockStandardUser,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )

      assert.equal(res.status, 200)
      assert.equal(tripsInserted.length, 1)
      // Game-day multiplier 2.1 overrides weekend surge 1.2
      assert.equal(tripsInserted[0].surge_multiplier, 2.1)
      assert.ok(tripsInserted[0].fare_cents > 0)
    })

    test('looks up game_day_events at the PICKUP time, not at request time', async () => {
      const { sb, operations } = createFakeSb({ gameDayEvents: [] })
      const gameTimeIso = '2026-10-03T18:00:00.000Z'
      const res = await callHandler(
        scheduleTripHandler,
        { method: 'POST', body: { ...defaultPlaces, pickupAt: gameTimeIso } },
        { user: mockStandardUser, sb, ensureProfile: async () => ({ ok: true }) },
      )
      assert.equal(res.status, 200)
      const gd = operations.filter((o) => o.table === 'game_day_events')
      assert.deepEqual(
        gd.filter((o) => ['eq', 'lte', 'gte'].includes(o.op)).map((o) => [o.op, o.col, o.val]),
        [
          ['eq', 'active', true],
          ['lte', 'starts_at', gameTimeIso],
          ['gte', 'ends_at', gameTimeIso],
        ],
      )
    })

    test('a game_day_events lookup that throws does not block scheduling (falls back to rules)', async () => {
      const { sb, tripsInserted } = createFakeSb()
      const realFrom = sb.from.bind(sb)
      sb.from = (table) => {
        if (table === 'game_day_events') throw new Error('relation does not exist')
        return realFrom(table)
      }
      // Saturday 2 PM EDT in October: the built-in game-day fallback window (1.8) applies.
      const res = await callHandler(
        scheduleTripHandler,
        { method: 'POST', body: { ...defaultPlaces, pickupAt: '2026-10-03T18:00:00.000Z' } },
        { user: mockStandardUser, sb, ensureProfile: async () => ({ ok: true }) },
      )
      assert.equal(res.status, 200)
      assert.equal(tripsInserted[0].surge_multiplier, 1.8)
    })

    test('falls back to standard or weekend surge when no game-day event is active', async () => {
      const { sb, tripsInserted } = createFakeSb({
        gameDayEvents: [], // no active events
      })

      // Wednesday midday: 2026-10-07T16:00:00Z (12:00 PM EDT) - non-surge window
      const regularTimeIso = '2026-10-07T16:00:00.000Z'
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: regularTimeIso,
            purpose: 'early_class',
          },
        },
        {
          user: mockStandardUser,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )

      assert.equal(res.status, 200)
      assert.equal(tripsInserted.length, 1)
      assert.equal(tripsInserted[0].surge_multiplier, 1)
    })
  })

  describe('Student discount granted vs not granted', () => {
    const testPickupTime = '2026-10-14T15:00:00.000Z'

    test('grants 10% student discount for confirmed @clemson.edu email on Standard tier', async () => {
      const { sb, tripsInserted } = createFakeSb()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: testPickupTime,
            tier: 'standard',
          },
        },
        {
          user: mockStudentUser,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )

      assert.equal(res.status, 200)
      assert.equal(res.json.studentDiscountApplied, true)
      assert.ok(res.json.discountCents > 0)
      assert.equal(tripsInserted[0].metadata.isStudent, true)
      assert.equal(tripsInserted[0].metadata.studentLabel, 'Clemson student · 10% off Standard')
      assert.equal(tripsInserted[0].metadata.student_discount_cents, res.json.discountCents)
    })

    test('student fare + discount equals the non-student fare for the same trip (10%, rounded)', async () => {
      const run = async (user) => {
        const { sb, tripsInserted } = createFakeSb()
        const res = await callHandler(
          scheduleTripHandler,
          { method: 'POST', body: { ...defaultPlaces, pickupAt: testPickupTime } },
          { user, sb, ensureProfile: async () => ({ ok: true }) },
        )
        assert.equal(res.status, 200)
        return { res: res.json, row: tripsInserted[0] }
      }
      const regular = await run(mockStandardUser)
      const student = await run(mockStudentUser)
      assert.equal(regular.res.discountCents, 0)
      assert.equal(student.res.fareCents + student.res.discountCents, regular.res.fareCents)
      assert.equal(student.res.discountCents, Math.round(regular.res.fareCents * 0.1))
      // Stored row, response, and the 20/80 split all agree.
      assert.equal(student.row.fare_cents, student.res.fareCents)
      assert.equal(student.row.platform_fee_cents + student.row.driver_earnings_cents, student.row.fare_cents)
      assert.equal(student.row.fare_breakdown.rider_pays_cents, student.res.fareCents)
    })

    test('client-sent isStudent / fare fields are ignored', async () => {
      const { sb, tripsInserted } = createFakeSb()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: { ...defaultPlaces, pickupAt: testPickupTime, isStudent: true, fare_cents: 1, amount: 1, total: 1 },
        },
        { user: mockStandardUser, sb, ensureProfile: async () => ({ ok: true }) },
      )
      assert.equal(res.status, 200)
      assert.equal(res.json.studentDiscountApplied, false)
      assert.equal(res.json.discountCents, 0)
      assert.ok(tripsInserted[0].fare_cents > 1)
      assert.equal(tripsInserted[0].metadata.fare_source, 'server')
    })

    test('grants 10% student discount for confirmed @g.clemson.edu email', async () => {
      const { sb } = createFakeSb()
      const gStudent = {
        id: 'user_g_student',
        email: 'tiger@g.clemson.edu',
        email_confirmed_at: '2026-02-01T00:00:00Z',
      }
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: testPickupTime,
          },
        },
        {
          user: gStudent,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )
      assert.equal(res.status, 200)
      assert.equal(res.json.studentDiscountApplied, true)
      assert.ok(res.json.discountCents > 0)
    })

    test('does NOT grant student discount when Clemson email is unconfirmed', async () => {
      const { sb, tripsInserted } = createFakeSb()
      const unconfirmedStudent = {
        id: 'user_unconfirmed',
        email: 'tiger@clemson.edu',
        // email_confirmed_at omitted
      }
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: testPickupTime,
          },
        },
        {
          user: unconfirmedStudent,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )
      assert.equal(res.status, 200)
      assert.equal(res.json.studentDiscountApplied, false)
      assert.equal(res.json.discountCents, 0)
      assert.equal(tripsInserted[0].metadata.isStudent, false)
      assert.equal(tripsInserted[0].metadata.studentLabel, null)
    })

    test('does NOT grant student discount for non-Clemson email address', async () => {
      const { sb, tripsInserted } = createFakeSb()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: testPickupTime,
          },
        },
        {
          user: mockStandardUser, // visitor@gmail.com
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )
      assert.equal(res.status, 200)
      assert.equal(res.json.studentDiscountApplied, false)
      assert.equal(res.json.discountCents, 0)
      assert.equal(tripsInserted[0].metadata.isStudent, false)
    })

    test('does NOT grant student discount on Tesla tier even for confirmed student', async () => {
      const { sb, tripsInserted } = createFakeSb()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: testPickupTime,
            tier: 'tesla',
          },
        },
        {
          user: mockStudentUser,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )
      assert.equal(res.status, 200)
      assert.equal(res.json.studentDiscountApplied, false)
      assert.equal(res.json.discountCents, 0)
      assert.equal(tripsInserted[0].tier, 'tesla')
      assert.equal(tripsInserted[0].metadata.tesla, true)
      assert.equal(tripsInserted[0].metadata.fleet, 'tesla_model_3')
    })
  })

  describe('Party size and vehicle capacity edge cases', () => {
    test('scheduleTrip records single passenger (passengers: 1) regardless of client partySize', async () => {
      const { sb, tripsInserted } = createFakeSb()
      const validFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: validFuture,
            purpose: 'party_weekend',
            passengers: 6,
            partySize: 8,
          },
        },
        {
          user: mockStandardUser,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )

      assert.equal(res.status, 200)
      assert.equal(tripsInserted.length, 1)
      // scheduleTrip enforces 1 passenger for personal/airport scheduled trips
      assert.equal(tripsInserted[0].passengers, 1)
      assert.equal(tripsInserted[0].metadata.party, 'weekend')
      assert.equal(tripsInserted[0].metadata.purpose, 'party_weekend')
    })

    test('returns 500 when database rejects trip insert (e.g. table capacity check constraint)', async () => {
      const { sb } = createFakeSb({
        tripInsertError: { message: 'check constraint "trips_party_capacity_check" failed' },
      })
      const validFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: validFuture,
            purpose: 'party_weekend',
          },
        },
        {
          user: mockStandardUser,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )

      assert.equal(res.status, 500)
      assert.equal(res.json.error, 'check constraint "trips_party_capacity_check" failed')
    })
  })

  describe('DST boundary handling (America/New_York, 2026-11-01)', () => {
    test('handles pickup times across Daylight Saving Time fall-back transition', async () => {
      const { sb, tripsInserted } = createFakeSb()
      // On Sunday, Nov 1, 2026, clocks fall back at 2:00 AM EDT to 1:00 AM EST.
      // 05:30:00Z corresponds to 1:30 AM EDT (UTC-4)
      // 06:30:00Z corresponds to 1:30 AM EST (UTC-5)
      const times = [
        '2026-11-01T05:30:00.000Z',
        '2026-11-01T06:30:00.000Z',
      ]

      for (const time of times) {
        const res = await callHandler(
          scheduleTripHandler,
          {
            method: 'POST',
            body: {
              ...defaultPlaces,
              pickupAt: time,
              purpose: 'party_weekend',
            },
          },
          {
            user: mockStandardUser,
            sb,
            ensureProfile: async () => ({ ok: true }),
          },
        )
        assert.equal(res.status, 200)
      }

      assert.equal(tripsInserted.length, 2)
      assert.equal(tripsInserted[0].pickup_at, '2026-11-01T05:30:00.000Z')
      assert.equal(tripsInserted[1].pickup_at, '2026-11-01T06:30:00.000Z')
      // Both occur during Sunday early morning (weekend surge applies)
      assert.equal(tripsInserted[0].surge_multiplier, 1.2)
      assert.equal(tripsInserted[1].surge_multiplier, 1.2)
    })
  })

  describe('Airport trips and special purposes', () => {
    test('explicit airport GSP overrides pickup to campus and dropoff to GSP with 25% deposit', async () => {
      const { sb, tripsInserted } = createFakeSb()
      const futureDate = new Date(Date.now() + 2 * 3600 * 1000).toISOString()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            airport: 'GSP',
            pickupAt: futureDate,
          },
        },
        {
          user: mockStandardUser,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )

      assert.equal(res.status, 200)
      assert.equal(tripsInserted.length, 1)
      assert.equal(tripsInserted[0].pickup_label, 'Memorial Stadium')
      assert.equal(tripsInserted[0].dropoff_label, 'Greenville-Spartanburg International (GSP)')
      assert.ok(tripsInserted[0].deposit_cents > 0)
      assert.equal(tripsInserted[0].metadata.airport, 'GSP')
      assert.equal(tripsInserted[0].metadata.purpose, 'airport')
    })

    test('recurring purpose persists recurrence metadata with weekdays', async () => {
      const { sb, tripsInserted } = createFakeSb()
      const futureDate = new Date(Date.now() + 2 * 3600 * 1000).toISOString()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: futureDate,
            purpose: 'recurring',
            weekdays: ['Mon', 'Wed', 'Fri'],
          },
        },
        {
          user: mockStandardUser,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )

      assert.equal(res.status, 200)
      assert.deepEqual(tripsInserted[0].metadata.recurrence, {
        interval: 'weekly',
        weekdays: ['Mon', 'Wed', 'Fri'],
      })
    })

    test('records trip_events entry with kind scheduled', async () => {
      const { sb, tripEventsInserted } = createFakeSb()
      const futureDate = new Date(Date.now() + 2 * 3600 * 1000).toISOString()
      const res = await callHandler(
        scheduleTripHandler,
        {
          method: 'POST',
          body: {
            ...defaultPlaces,
            pickupAt: futureDate,
            purpose: 'early_class',
          },
        },
        {
          user: mockStandardUser,
          sb,
          ensureProfile: async () => ({ ok: true }),
        },
      )

      assert.equal(res.status, 200)
      assert.equal(tripEventsInserted.length, 1)
      assert.equal(tripEventsInserted[0].kind, 'scheduled')
      assert.equal(tripEventsInserted[0].payload.purpose, 'early_class')
      assert.equal(tripEventsInserted[0].payload.fare_source, 'server')
    })

    // Failed trip_events writes are logged and surfaced (HTTP 500 + code), while the
    // already-inserted trip id is returned so the client is not left blind.
    test('a failed trip_events insert returns 500 with trip_event_failed and the trip', async () => {
      const { sb, tripsInserted, tripEventsInserted } = createFakeSb({
        tripEventInsertError: { message: 'insert or update on table "trip_events" violates foreign key' },
      })
      const logged = []
      const originalError = console.error
      console.error = (...args) => { logged.push(args.map(String).join(' ')) }
      let res
      try {
        res = await callHandler(
          scheduleTripHandler,
          { method: 'POST', body: { ...defaultPlaces, pickupAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString() } },
          { user: mockStandardUser, sb, ensureProfile: async () => ({ ok: true }) },
        )
      } finally {
        console.error = originalError
      }
      assert.equal(res.status, 500)
      assert.equal(res.json.code, 'trip_event_failed')
      assert.match(res.json.error, /foreign key/)
      assert.equal(tripsInserted.length, 1)
      assert.ok(res.json.trip?.id)
      assert.equal(res.json.trip.id, tripsInserted[0].id)
      assert.equal(tripEventsInserted.length, 0)
      assert.equal(logged.some((line) => line.includes('[trip_events]') && line.includes('scheduled')), true)
    })

    test('no trip row is written when the rider profile cannot be created', async () => {
      const { sb, tripsInserted, tripEventsInserted } = createFakeSb()
      const res = await callHandler(
        scheduleTripHandler,
        { method: 'POST', body: { ...defaultPlaces, pickupAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString() } },
        { user: mockStandardUser, sb, ensureProfile: async () => ({ ok: false }) },
      )
      assert.equal(res.status, 500)
      assert.equal(tripsInserted.length, 0)
      assert.equal(tripEventsInserted.length, 0)
    })
  })
})

describe('takeReminder (real src/lib/scheduledRides.js)', () => {
  // takeReminder keeps a module-level Set of session stamps keyed by trip id, so every
  // test uses its own trip id instead of resetting module state.
  const now = new Date('2026-10-03T16:00:00.000Z')
  const at = (minutes) => new Date(now.getTime() + minutes * 60 * 1000).toISOString()

  test('returns null when the trip has no id', () => {
    assert.equal(takeReminder(null, now), null)
    assert.equal(takeReminder({}, now), null)
    assert.equal(takeReminder({ id: '', pickup_at: at(10) }, now), null)
  })

  test('picks the tightest window: m15, h1, h24; nothing more than 24h out', () => {
    assert.equal(takeReminder({ id: 'rem-w-1', pickup_at: at(10) }, now).id, 'm15')
    assert.equal(takeReminder({ id: 'rem-w-2', pickup_at: at(15) }, now).id, 'm15') // boundary is inclusive
    assert.equal(takeReminder({ id: 'rem-w-3', pickup_at: at(16) }, now).id, 'h1')
    assert.equal(takeReminder({ id: 'rem-w-4', pickup_at: at(60) }, now).id, 'h1')
    assert.equal(takeReminder({ id: 'rem-w-5', pickup_at: at(61) }, now).id, 'h24')
    assert.equal(takeReminder({ id: 'rem-w-6', pickup_at: at(24 * 60) }, now).id, 'h24')
    assert.equal(takeReminder({ id: 'rem-w-7', pickup_at: at(24 * 60 + 1) }, now), null)
  })

  test('falls back to scheduled_for when pickup_at is missing', () => {
    assert.equal(takeReminder({ id: 'rem-sf-1', scheduled_for: at(30) }, now).id, 'h1')
  })

  test('fires "now" at pickup and for 20 minutes after, then goes quiet', () => {
    assert.equal(takeReminder({ id: 'rem-now-1', pickup_at: at(0) }, now).id, 'now')
    assert.equal(takeReminder({ id: 'rem-now-2', pickup_at: at(-20) }, now).id, 'now')
    assert.equal(takeReminder({ id: 'rem-now-3', pickup_at: at(-21) }, now), null)
  })

  test('only scheduled / accepted / arriving trips get reminders', () => {
    for (const status of ['scheduled', 'accepted', 'arriving']) {
      assert.equal(takeReminder({ id: `rem-st-${status}`, status, pickup_at: at(10) }, now).id, 'm15', status)
    }
    for (const status of ['canceled', 'completed', 'searching', 'in_progress']) {
      assert.equal(takeReminder({ id: `rem-st-${status}`, status, pickup_at: at(10) }, now), null, status)
    }
  })

  test('fires once per window per session; the next window still fires later', () => {
    const trip = { id: 'rem-sess-1', pickup_at: at(45) }
    assert.equal(takeReminder(trip, now).id, 'h1')
    assert.equal(takeReminder(trip, now), null) // same window, same session
    const later = new Date(now.getTime() + 35 * 60 * 1000) // 10 minutes before pickup
    assert.equal(takeReminder(trip, later).id, 'm15')
    assert.equal(takeReminder(trip, later), null)
  })

  test('session stamps are per trip: another trip in the same window still fires', () => {
    assert.equal(takeReminder({ id: 'rem-iso-a', pickup_at: at(10) }, now).id, 'm15')
    assert.equal(takeReminder({ id: 'rem-iso-b', pickup_at: at(10) }, now).id, 'm15')
  })

  test('respects persisted metadata.reminders stamps and does not mutate the trip', () => {
    const trip = { id: 'rem-meta-1', pickup_at: at(10), metadata: { reminders: { m15: true } } }
    assert.equal(takeReminder(trip, now), null)
    assert.deepEqual(trip.metadata.reminders, { m15: true })
  })

  test('windows filter suppresses other windows WITHOUT consuming them', () => {
    const trip = { id: 'rem-filter-1', pickup_at: at(10) }
    assert.equal(takeReminder(trip, now, { windows: ['h24'] }), null)
    // Suppressed decision was not stamped, so an unfiltered caller still gets it.
    assert.equal(takeReminder(trip, now).id, 'm15')
    assert.equal(takeReminder({ id: 'rem-filter-2', pickup_at: at(10) }, now, { windows: ['m15', 'now'] }).id, 'm15')
  })

  test('invalid or missing pickup times never produce a reminder', () => {
    assert.equal(takeReminder({ id: 'rem-bad-1' }, now), null)
    assert.equal(takeReminder({ id: 'rem-bad-2', pickup_at: 'not a date' }, now), null)
  })
})
