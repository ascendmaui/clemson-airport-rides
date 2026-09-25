import assert from 'node:assert/strict'
import test, { describe, beforeEach, afterEach } from 'node:test'
import scheduleTripHandler from './endpoints/scheduleTrip.js'
import { takeReminder as stubbedTakeReminder, clearSessionStamps } from '../tests/fixtures/scheduledRidesStub.js'

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
      assert.equal(tripsInserted[0].pickup_at, new Date('2027-05-20T14:00:00').toISOString())
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
  })
})

describe('takeReminder (src/lib/scheduledRides.js & stub fixture)', () => {
  beforeEach(() => {
    clearSessionStamps()
  })

  test('verifies direct import of src/lib/scheduledRides.js fails under Node ESM due to extensionless ./supabase', async (t) => {
    // Note: src/lib/scheduledRides.js contains `import { supabase } from './supabase'` (missing .js extension).
    // Pure Node ESM resolution rejects extensionless imports with ERR_MODULE_NOT_FOUND.
    // Per instructions: "if import fails, stub it via a test-only fixture/loader under tests/fixtures, else skip and note it."
    let failed = false
    try {
      await import('../src/lib/scheduledRides.js')
    } catch (err) {
      failed = true
      assert.equal(err.code, 'ERR_MODULE_NOT_FOUND')
    }
    assert.equal(failed, true, 'direct import of scheduledRides.js should fail under Node ESM')
    t.skip('Skipped direct scheduledRides.js import test due to extensionless ./supabase import; tested via tests/fixtures stub below')
  })

  test('takeReminder returns null when trip has no id', () => {
    assert.equal(stubbedTakeReminder(null), null)
    assert.equal(stubbedTakeReminder({}), null)
    assert.equal(stubbedTakeReminder({ id: '' }), null)
  })

  test('takeReminder returns decision for due pickup window and avoids duplicate in same session', () => {
    // Trip pickup in 15 minutes
    const now = new Date('2026-10-03T16:00:00.000Z')
    const pickupAt = new Date('2026-10-03T16:15:00.000Z')
    const trip = {
      id: 'trip-rem-1',
      pickup_at: pickupAt.toISOString(),
      metadata: { reminders: {} },
    }

    const firstDecision = stubbedTakeReminder(trip, now)
    assert.ok(firstDecision)
    assert.equal(firstDecision.id, 'm15')

    // Second call in same session should return null (already session-stamped)
    const secondDecision = stubbedTakeReminder(trip, now)
    assert.equal(secondDecision, null)
  })

  test('takeReminder filters by allowed windows option', () => {
    const now = new Date('2026-10-03T16:00:00.000Z')
    const pickupAt = new Date('2026-10-03T16:15:00.000Z')
    const trip = {
      id: 'trip-rem-2',
      pickup_at: pickupAt.toISOString(),
      metadata: { reminders: {} },
    }

    // Only allow 'h24' window; 'm15' decision should be suppressed
    const decision = stubbedTakeReminder(trip, now, { windows: ['h24'] })
    assert.equal(decision, null)
  })

  test('takeReminder respects existing persistent stamps in trip metadata', () => {
    const now = new Date('2026-10-03T16:00:00.000Z')
    const pickupAt = new Date('2026-10-03T16:15:00.000Z')
    const trip = {
      id: 'trip-rem-3',
      pickup_at: pickupAt.toISOString(),
      metadata: { reminders: { m15: true } },
    }

    const decision = stubbedTakeReminder(trip, now)
    assert.equal(decision, null)
  })
})
