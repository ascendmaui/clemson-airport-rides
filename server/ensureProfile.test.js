import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureProfile } from './ensureProfile.js'
import createCheckoutSessionHandler from '../api/create-checkout-session.js'
import airportCheckoutHandler from './endpoints/airportCheckout.js'
import scheduleTripHandler from './endpoints/scheduleTrip.js'
import requestDriverTripHandler from './endpoints/requestDriverTrip.js'

function createFakeSb({
  existing = null,
  selectError = null,
  upsertErrors = [],
  upsertHandler = null,
} = {}) {
  const calls = []
  let upsertCount = 0

  const sb = {
    calls,
    from(table) {
      calls.push({ op: 'from', table })
      return {
        select(columns) {
          calls.push({ op: 'select', table, columns })
          return {
            eq(col, val) {
              calls.push({ op: 'eq', table, col, val })
              return {
                async maybeSingle() {
                  calls.push({ op: 'maybeSingle', table, col, val })
                  if (selectError) {
                    return { data: null, error: selectError }
                  }
                  return { data: existing, error: null }
                },
              }
            },
          }
        },
        async upsert(payload, options) {
          const callIndex = upsertCount++
          calls.push({ op: 'upsert', table, payload: { ...payload }, options: { ...options }, callIndex })
          if (typeof upsertHandler === 'function') {
            return upsertHandler(payload, options, callIndex)
          }
          if (upsertErrors.length > callIndex) {
            const err = upsertErrors[callIndex]
            if (err) return { data: null, error: err }
          }
          return { data: null, error: null }
        },
      }
    },
  }

  return { sb, calls }
}

test('existing row: returns ok:true, created:false with no write', async () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const { sb, calls } = createFakeSb({ existing: { id: userId } })

  const user = {
    id: userId,
    email: 'existing@clemson.edu',
    user_metadata: { full_name: 'Existing Rider' },
  }

  const res = await ensureProfile(sb, user)

  assert.deepEqual(res, { ok: true, created: false })

  const upserts = calls.filter((c) => c.op === 'upsert')
  assert.equal(upserts.length, 0, 'Must perform no upsert if profile already exists')

  const select = calls.find((c) => c.op === 'select')
  assert.ok(select, 'Must perform select')
  assert.equal(select.columns, 'id')

  const eq = calls.find((c) => c.op === 'eq')
  assert.deepEqual({ col: eq.col, val: eq.val }, { col: 'id', val: userId })
})

test('missing row: performs one upsert with correct payload and options', async () => {
  const userId = '22222222-2222-4222-8222-222222222222'
  const { sb, calls } = createFakeSb({ existing: null })

  const user = {
    id: userId,
    email: 'newrider@clemson.edu',
    user_metadata: { full_name: 'New Rider' },
  }

  const res = await ensureProfile(sb, user)

  assert.deepEqual(res, { ok: true, created: true })

  const upserts = calls.filter((c) => c.op === 'upsert')
  assert.equal(upserts.length, 1, 'Must perform exactly one upsert')

  const call = upserts[0]
  assert.equal(call.table, 'profiles')
  assert.deepEqual(call.options, { onConflict: 'id', ignoreDuplicates: true })
  assert.deepEqual(call.payload, {
    id: userId,
    email: 'newrider@clemson.edu',
    full_name: 'New Rider',
    role: 'rider',
  })
})

test('missing row: falls back to user_metadata.name and handles null email', async () => {
  const userId = '33333333-3333-4333-8333-333333333333'
  const { sb, calls } = createFakeSb({ existing: null })

  const user = {
    id: userId,
    user_metadata: { name: 'Fallback Name' },
  }

  const res = await ensureProfile(sb, user)

  assert.deepEqual(res, { ok: true, created: true })

  const upserts = calls.filter((c) => c.op === 'upsert')
  assert.equal(upserts.length, 1)
  assert.deepEqual(upserts[0].payload, {
    id: userId,
    email: null,
    full_name: 'Fallback Name',
    role: 'rider',
  })
})

test('23505 race: returns ok:true, created:false on Postgres unique violation', async () => {
  const userId = '44444444-4444-4444-8444-444444444444'
  const uniqueErr = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "profiles_pkey"',
    details: `Key (id)=(${userId}) already exists.`,
  }
  const { sb, calls } = createFakeSb({
    existing: null,
    upsertErrors: [uniqueErr],
  })

  const user = {
    id: userId,
    email: 'concurrent@clemson.edu',
    user_metadata: { full_name: 'Concurrent Rider' },
  }

  const res = await ensureProfile(sb, user)

  assert.deepEqual(res, { ok: true, created: false })

  const upserts = calls.filter((c) => c.op === 'upsert')
  assert.equal(upserts.length, 1, 'Should not retry when 23505 is returned')
})

test('23505 race: matches 23505 in error message when error code is missing', async () => {
  const userId = '44444444-4444-4444-8444-444444444445'
  const { sb } = createFakeSb({
    existing: null,
    upsertErrors: [{ message: 'duplicate key value violates unique constraint 23505' }],
  })

  const res = await ensureProfile(sb, { id: userId, email: 'race@clemson.edu' })
  assert.deepEqual(res, { ok: true, created: false })
})

test('column-error fallback: retries once with just { id, email } when schema/column error occurs', async () => {
  const userId = '55555555-5555-4555-8555-555555555555'
  const columnErr = {
    code: 'PGRST204',
    message: "Could not find the 'full_name' column of 'profiles' in the schema cache",
  }
  const { sb, calls } = createFakeSb({
    existing: null,
    upsertErrors: [columnErr, null],
  })

  const user = {
    id: userId,
    email: 'narrow@clemson.edu',
    user_metadata: { full_name: 'Narrow Rider' },
  }

  const res = await ensureProfile(sb, user)

  assert.deepEqual(res, { ok: true, created: true })

  const upserts = calls.filter((c) => c.op === 'upsert')
  assert.equal(upserts.length, 2, 'Must retry once after column error')

  // First call had full payload
  assert.deepEqual(upserts[0].payload, {
    id: userId,
    email: 'narrow@clemson.edu',
    full_name: 'Narrow Rider',
    role: 'rider',
  })

  // Second call had only id and email
  assert.deepEqual(upserts[1].payload, {
    id: userId,
    email: 'narrow@clemson.edu',
  })
  assert.deepEqual(upserts[1].options, {
    onConflict: 'id',
    ignoreDuplicates: true,
  })
})

test('column-error fallback: treats 23505 on retry as success (created:false)', async () => {
  const userId = '55555555-5555-4555-8555-555555555556'
  const { sb } = createFakeSb({
    existing: null,
    upsertErrors: [
      { code: '42703', message: 'column "role" of relation "profiles" does not exist' },
      { code: '23505', message: 'duplicate key value violates unique constraint' },
    ],
  })

  const res = await ensureProfile(sb, { id: userId, email: 'retry-race@clemson.edu' })
  assert.deepEqual(res, { ok: true, created: false })
})

test('generic error: returns ok:false, reason:profile_upsert_failed and message on upsert failure', async () => {
  const userId = '66666666-6666-4666-8666-666666666666'
  const dbErr = {
    code: '08006',
    message: 'connection failure during upsert',
  }
  const { sb, calls } = createFakeSb({
    existing: null,
    upsertErrors: [dbErr],
  })

  const user = {
    id: userId,
    email: 'fail@clemson.edu',
  }

  const res = await ensureProfile(sb, user)

  assert.deepEqual(res, {
    ok: false,
    reason: 'profile_upsert_failed',
    message: 'connection failure during upsert',
  })

  const upserts = calls.filter((c) => c.op === 'upsert')
  assert.equal(upserts.length, 1, 'Should not retry on generic errors')
})

test('generic error: returns ok:false, reason:profile_upsert_failed when retry fails', async () => {
  const userId = '66666666-6666-4666-8666-666666666667'
  const { sb, calls } = createFakeSb({
    existing: null,
    upsertErrors: [
      { message: 'schema cache reload required' },
      { message: 'disk full on retry' },
    ],
  })

  const res = await ensureProfile(sb, { id: userId, email: 'fail-retry@clemson.edu' })

  assert.deepEqual(res, {
    ok: false,
    reason: 'profile_upsert_failed',
    message: 'disk full on retry',
  })

  const upserts = calls.filter((c) => c.op === 'upsert')
  assert.equal(upserts.length, 2)
})

test('missing user: returns ok:false, reason:no_user without throwing', async () => {
  const { sb, calls } = createFakeSb({ existing: null })

  // Null / undefined sb
  assert.deepEqual(await ensureProfile(null, { id: 'u1' }), { ok: false, reason: 'no_user' })
  assert.deepEqual(await ensureProfile(undefined, { id: 'u1' }), { ok: false, reason: 'no_user' })

  // Missing / invalid user
  assert.deepEqual(await ensureProfile(sb, null), { ok: false, reason: 'no_user' })
  assert.deepEqual(await ensureProfile(sb, undefined), { ok: false, reason: 'no_user' })
  assert.deepEqual(await ensureProfile(sb, {}), { ok: false, reason: 'no_user' })
  assert.deepEqual(await ensureProfile(sb, { id: null }), { ok: false, reason: 'no_user' })
  assert.deepEqual(await ensureProfile(sb, { id: undefined }), { ok: false, reason: 'no_user' })
  assert.deepEqual(await ensureProfile(sb, { id: '' }), { ok: false, reason: 'no_user' })
  assert.deepEqual(await ensureProfile(sb, 'not-an-object'), { ok: false, reason: 'no_user' })

  assert.equal(calls.length, 0, 'No queries should be made when user/sb is invalid')
})

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

function createMockEndpointSb({
  profileExisting = null,
  profileUpsertError = null,
  onTripInsert = null,
} = {}) {
  const operations = []
  const tripsInserted = []

  const sb = {
    operations,
    tripsInserted,
    from(table) {
      operations.push({ op: 'from', table })

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
          return chain
        },
        gte(col, val) {
          operations.push({ op: 'gte', table, col, val })
          return chain
        },
        gt(col, val) {
          operations.push({ op: 'gt', table, col, val })
          return chain
        },
        order(col, opts) {
          operations.push({ op: 'order', table, col, opts })
          return chain
        },
        limit(num) {
          operations.push({ op: 'limit', table, num })
          return chain
        },
        async maybeSingle() {
          operations.push({ op: 'maybeSingle', table })
          if (table === 'profiles') {
            return { data: profileExisting, error: null }
          }
          return { data: null, error: null }
        },
        async single() {
          operations.push({ op: 'single', table })
          if (table === 'trips') {
            const trip = tripsInserted[tripsInserted.length - 1] || { id: 'trip_mock_default' }
            return {
              data: {
                id: trip.id || 'trip_mock_123',
                status: trip.status || 'searching',
                driver_id: trip.driver_id || null,
                pickup_at: trip.pickup_at || null,
                pickup_label: trip.pickup_label || 'Mock Pickup',
                dropoff_label: trip.dropoff_label || 'Mock Dropoff',
                fare_cents: trip.fare_cents || 2500,
                deposit_cents: trip.deposit_cents || 625,
              },
              error: null,
            }
          }
          return { data: null, error: null }
        },
        async upsert(payload, options) {
          operations.push({ op: 'upsert', table, payload, options })
          if (table === 'profiles' && profileUpsertError) {
            return { data: null, error: profileUpsertError }
          }
          return { data: null, error: null }
        },
        insert(payload) {
          operations.push({ op: 'insert', table, payload })
          if (table === 'trips') {
            const trip = { id: 'trip_' + Math.random().toString(36).slice(2, 9), ...payload }
            tripsInserted.push(trip)
            if (typeof onTripInsert === 'function') {
              onTripInsert(trip)
            }
          }
          return chain
        },
        async update(payload) {
          operations.push({ op: 'update', table, payload })
          return { data: null, error: null }
        },
        then(resolve) {
          resolve({ data: null, error: null })
        },
      }
      return chain
    },
  }

  return { sb, operations, tripsInserted }
}

const mockAuthedUser = {
  id: '77777777-7777-4777-8777-777777777777',
  email: 'rider@clemson.edu',
  user_metadata: { full_name: 'Test Rider' },
}

test('scheduleTrip: returns 500 profile_missing and skips trip insert if ensureProfile fails', async () => {
  const { sb, tripsInserted } = createMockEndpointSb()
  let ensureProfileCalled = false

  const res = await callHandler(
    scheduleTripHandler,
    {
      method: 'POST',
      body: {
        purpose: 'planned',
        pickup: { label: 'Clemson Campus', lat: 34.6788, lng: -82.843 },
        dropoff: { label: 'Downtown', lat: 34.68, lng: -82.83 },
        scheduled: false,
      },
    },
    {
      user: mockAuthedUser,
      sb,
      ensureProfile: async () => {
        ensureProfileCalled = true
        return { ok: false, reason: 'profile_upsert_failed' }
      },
    },
  )

  assert.equal(ensureProfileCalled, true)
  assert.equal(res.status, 500)
  assert.deepEqual(res.json, {
    error: 'Could not create your rider profile',
    code: 'profile_missing',
  })
  assert.equal(tripsInserted.length, 0, 'No trip should be inserted when ensureProfile fails')
})

test('scheduleTrip: runs ensureProfile before inserting trip', async () => {
  const sequence = []
  const { sb, tripsInserted } = createMockEndpointSb({
    onTripInsert: () => sequence.push('insertTrip'),
  })

  const res = await callHandler(
    scheduleTripHandler,
    {
      method: 'POST',
      body: {
        purpose: 'planned',
        pickup: { label: 'Clemson Campus', lat: 34.6788, lng: -82.843 },
        dropoff: { label: 'Downtown', lat: 34.68, lng: -82.83 },
        scheduled: false,
      },
    },
    {
      user: mockAuthedUser,
      sb,
      ensureProfile: async (passedSb, passedUser) => {
        assert.equal(passedSb, sb)
        assert.equal(passedUser.id, mockAuthedUser.id)
        sequence.push('ensureProfile')
        return { ok: true, created: true }
      },
    },
  )

  assert.equal(res.status, 200)
  assert.deepEqual(sequence, ['ensureProfile', 'insertTrip'])
  assert.equal(tripsInserted.length, 1)
  assert.equal(tripsInserted[0].rider_id, mockAuthedUser.id)
})

test('requestDriverTrip: returns 500 profile_missing and skips trip insert if ensureProfile fails', async () => {
  const { sb, tripsInserted } = createMockEndpointSb()
  let ensureProfileCalled = false

  const res = await callHandler(
    requestDriverTripHandler,
    {
      method: 'POST',
      body: {
        driverId: 'drv_test_123',
        pickupLabel: 'Clemson Campus',
        pickupLat: 34.6788,
        pickupLng: -82.843,
        dropoffLabel: 'Downtown',
        destLat: 34.68,
        destLng: -82.83,
      },
    },
    {
      user: mockAuthedUser,
      sb,
      ensureProfile: async () => {
        ensureProfileCalled = true
        return { ok: false, reason: 'profile_upsert_failed' }
      },
    },
  )

  assert.equal(ensureProfileCalled, true)
  assert.equal(res.status, 500)
  assert.deepEqual(res.json, {
    error: 'Could not create your rider profile',
    code: 'profile_missing',
  })
  assert.equal(tripsInserted.length, 0, 'No trip should be inserted when ensureProfile fails')
})

test('requestDriverTrip: runs ensureProfile before inserting trip', async () => {
  const sequence = []
  const { sb, tripsInserted } = createMockEndpointSb({
    onTripInsert: () => sequence.push('insertTrip'),
  })

  const res = await callHandler(
    requestDriverTripHandler,
    {
      method: 'POST',
      body: {
        driverId: 'drv_test_123',
        pickupLabel: 'Clemson Campus',
        pickupLat: 34.6788,
        pickupLng: -82.843,
        dropoffLabel: 'Downtown',
        destLat: 34.68,
        destLng: -82.83,
      },
    },
    {
      user: mockAuthedUser,
      sb,
      ensureProfile: async (passedSb, passedUser) => {
        assert.equal(passedSb, sb)
        assert.equal(passedUser.id, mockAuthedUser.id)
        sequence.push('ensureProfile')
        return { ok: true, created: true }
      },
    },
  )

  assert.equal(res.status, 200)
  assert.deepEqual(sequence, ['ensureProfile', 'insertTrip'])
  assert.equal(tripsInserted.length, 1)
  assert.equal(tripsInserted[0].rider_id, mockAuthedUser.id)
})

test('airportCheckout: returns 500 profile_missing and skips trip insert if ensureProfile fails', async () => {
  const { sb, tripsInserted } = createMockEndpointSb()
  let ensureProfileCalled = false

  const res = await callHandler(
    airportCheckoutHandler,
    {
      method: 'POST',
      body: {
        airport: 'GSP',
        useCredits: false,
      },
    },
    {
      user: mockAuthedUser,
      sb,
      stripeOk: () => true,
      ensureProfile: async () => {
        ensureProfileCalled = true
        return { ok: false, reason: 'profile_upsert_failed' }
      },
    },
  )

  assert.equal(ensureProfileCalled, true)
  assert.equal(res.status, 500)
  assert.deepEqual(res.json, {
    error: 'Could not create your rider profile',
    code: 'profile_missing',
  })
  assert.equal(tripsInserted.length, 0, 'No trip should be inserted when ensureProfile fails')
})

test('airportCheckout: runs ensureProfile before inserting trip', async () => {
  const sequence = []
  const { sb, tripsInserted } = createMockEndpointSb({
    onTripInsert: () => sequence.push('insertTrip'),
  })

  const res = await callHandler(
    airportCheckoutHandler,
    {
      method: 'POST',
      body: {
        airport: 'GSP',
        useCredits: false,
      },
    },
    {
      user: mockAuthedUser,
      sb,
      stripeOk: () => true,
      stripe: {
        checkout: {
          sessions: {
            create: async () => ({ id: 'cs_test_airport', url: 'https://checkout.stripe.com/test' }),
          },
        },
      },
      ensureProfile: async (passedSb, passedUser) => {
        assert.equal(passedSb, sb)
        assert.equal(passedUser.id, mockAuthedUser.id)
        sequence.push('ensureProfile')
        return { ok: true, created: true }
      },
    },
  )

  assert.equal(res.status, 200)
  assert.deepEqual(sequence, ['ensureProfile', 'insertTrip'])
  assert.equal(tripsInserted.length, 1)
  assert.equal(tripsInserted[0].rider_id, mockAuthedUser.id)
})

test('createCheckoutSession: returns 500 profile_missing and skips trip insert if ensureProfile fails', async () => {
  const { sb, tripsInserted } = createMockEndpointSb()
  let ensureProfileCalled = false

  const res = await callHandler(
    createCheckoutSessionHandler,
    {
      method: 'POST',
      body: {
        airport: 'GSP',
      },
    },
    {
      user: mockAuthedUser,
      sb,
      stripeOk: () => true,
      ensureProfile: async () => {
        ensureProfileCalled = true
        return { ok: false, reason: 'profile_upsert_failed' }
      },
    },
  )

  assert.equal(ensureProfileCalled, true)
  assert.equal(res.status, 500)
  assert.deepEqual(res.json, {
    error: 'Could not create your rider profile',
    code: 'profile_missing',
  })
  assert.equal(tripsInserted.length, 0, 'No trip should be inserted when ensureProfile fails')
})

test('createCheckoutSession: runs ensureProfile before inserting trip', async () => {
  const sequence = []
  const { sb, tripsInserted } = createMockEndpointSb({
    onTripInsert: () => sequence.push('insertTrip'),
  })

  const res = await callHandler(
    createCheckoutSessionHandler,
    {
      method: 'POST',
      body: {
        airport: 'GSP',
      },
    },
    {
      user: mockAuthedUser,
      sb,
      stripeOk: () => true,
      stripe: {
        checkout: {
          sessions: {
            create: async () => ({ id: 'cs_test_session', url: 'https://checkout.stripe.com/test' }),
          },
        },
      },
      ensureProfile: async (passedSb, passedUser) => {
        assert.equal(passedSb, sb)
        assert.equal(passedUser.id, mockAuthedUser.id)
        sequence.push('ensureProfile')
        return { ok: true, created: true }
      },
    },
  )

  assert.equal(res.status, 200)
  assert.deepEqual(sequence, ['ensureProfile', 'insertTrip'])
  assert.equal(tripsInserted.length, 1)
  assert.equal(tripsInserted[0].rider_id, mockAuthedUser.id)
})

test('integration: default ensureProfile executes profile upsert before trips insert', async () => {
  const { sb, operations, tripsInserted } = createMockEndpointSb({ profileExisting: null })

  const res = await callHandler(
    scheduleTripHandler,
    {
      method: 'POST',
      body: {
        purpose: 'planned',
        pickup: { label: 'Clemson Campus', lat: 34.6788, lng: -82.843 },
        dropoff: { label: 'Downtown', lat: 34.68, lng: -82.83 },
        scheduled: false,
      },
    },
    {
      user: mockAuthedUser,
      sb,
    },
  )

  assert.equal(res.status, 200)
  assert.equal(tripsInserted.length, 1)

  const profileUpsertIdx = operations.findIndex((op) => op.op === 'upsert' && op.table === 'profiles')
  const tripInsertIdx = operations.findIndex((op) => op.op === 'insert' && op.table === 'trips')
  assert.ok(profileUpsertIdx !== -1, 'Profile upsert must be called')
  assert.ok(tripInsertIdx !== -1, 'Trip insert must be called')
  assert.ok(profileUpsertIdx < tripInsertIdx, 'Profile upsert must happen BEFORE trip insert')
})

test('integration: default ensureProfile failure returns 500 profile_missing and skips trip insert', async () => {
  const { sb, tripsInserted } = createMockEndpointSb({
    profileExisting: null,
    profileUpsertError: { code: '08006', message: 'connection failure during upsert' },
  })

  const res = await callHandler(
    scheduleTripHandler,
    {
      method: 'POST',
      body: {
        purpose: 'planned',
        pickup: { label: 'Clemson Campus', lat: 34.6788, lng: -82.843 },
        dropoff: { label: 'Downtown', lat: 34.68, lng: -82.83 },
        scheduled: false,
      },
    },
    {
      user: mockAuthedUser,
      sb,
    },
  )

  assert.equal(res.status, 500)
  assert.deepEqual(res.json, {
    error: 'Could not create your rider profile',
    code: 'profile_missing',
  })
  assert.equal(tripsInserted.length, 0, 'Must not insert trip if real ensureProfile fails')
})


