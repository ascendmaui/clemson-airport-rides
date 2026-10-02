import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'

// Prevent unexpected network calls in offline test execution
globalThis.fetch = async function forbiddenFetch() {
  throw new Error('offline test tried to call fetch')
}

const KEY = '__t1ScheduleApi'

function dataUrl(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`
}

const supabaseUrl = dataUrl(`
  export let supabase = null
  export function __setSupabase(next) { supabase = next }
`)

const apiClientUrl = dataUrl(`
  const key = ${JSON.stringify(KEY)}
  export async function authedJson(client, path, options) {
    const state = globalThis[key]
    state.authedCalls.push({ client, path, options })
    if (state.authedError) throw state.authedError
    return state.authedResult
  }
`)

const PARENT = '/apps/rider/lib/scheduleApi.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || ''
    if (!parent.includes(PARENT)) return nextResolve(specifier, context)
    if (specifier === '@/lib/supabase') return { url: supabaseUrl, shortCircuit: true }
    if (specifier === 'rides-native/apiClient' || specifier === 'rides-native/apiClient.js') {
      return { url: apiClientUrl, shortCircuit: true }
    }
    if (specifier === 'rides-native/riderShell.js') {
      return { url: 'file://' + path.resolve('packages/rides-native/riderShell.js'), shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

function initState() {
  globalThis[KEY] = {
    authedCalls: [],
    authedResult: null,
    authedError: null,
    supabaseOps: [],
  }
}

function state() {
  return globalThis[KEY]
}

function mockSupabase(respond) {
  return {
    from(table) {
      const op = { table, filters: [], order: null, limit: null }
      let pending = null
      const run = () => {
        if (!pending) {
          state().supabaseOps.push(op)
          pending = Promise.resolve().then(() => respond(op))
        }
        return pending
      }
      const builder = {
        select(columns) {
          op.action = 'select'
          op.columns = columns
          return builder
        },
        update(payload) {
          op.action = 'update'
          op.payload = payload
          return builder
        },
        eq(column, value) {
          op.filters.push({ kind: 'eq', column, value })
          return builder
        },
        not(column, operator, value) {
          op.filters.push({ kind: 'not', column, operator, value })
          return builder
        },
        in(column, values) {
          op.filters.push({ kind: 'in', column, values })
          return builder
        },
        order(column, options) {
          op.order = { column, ...options }
          return builder
        },
        limit(count) {
          op.limit = count
          return builder
        },
        then(onFulfilled, onRejected) {
          return run().then(onFulfilled, onRejected)
        },
        catch(onRejected) {
          return run().catch(onRejected)
        },
      }
      return builder
    },
  }
}

test('quoteRide calculates GSP and CLT airport quotes with student discount and 25% deposit', async () => {
  const api = await import('./scheduleApi.ts')

  const pickup = { label: 'Clemson University Core Campus', lat: 34.678, lng: -82.833 }
  const gspDropoff = { label: 'Greenville-Spartanburg International Airport (GSP)', lat: 34.895, lng: -82.218 }
  const cltDropoff = { label: 'Charlotte Douglas International Airport (CLT)', lat: 35.214, lng: -80.943 }

  // 1. GSP Non-student quote
  const gspQuote = api.quoteRide(pickup, gspDropoff, false)
  assert.equal(gspQuote.airport, 'GSP')
  assert.equal(gspQuote.estimate, false)
  assert.equal(gspQuote.miles, null)
  assert.equal(gspQuote.fareCents, 6846)
  assert.equal(gspQuote.discountCents, 0)
  assert.equal(gspQuote.depositCents, 1712) // Math.round(6846 * 0.25) = 1712

  // 2. GSP Student quote (10% off Standard)
  const gspStudentQuote = api.quoteRide(pickup, gspDropoff, true)
  assert.equal(gspStudentQuote.airport, 'GSP')
  assert.equal(gspStudentQuote.estimate, false)
  assert.equal(gspStudentQuote.miles, null)
  assert.equal(gspStudentQuote.fareCents, 6161)
  assert.equal(gspStudentQuote.discountCents, 685)
  assert.equal(gspStudentQuote.depositCents, 1540) // Math.round(6161 * 0.25) = 1540
  assert.match(gspStudentQuote.label, /Clemson student/)

  // 3. CLT Non-student quote
  const cltQuote = api.quoteRide(pickup, cltDropoff, false)
  assert.equal(cltQuote.airport, 'CLT')
  assert.equal(cltQuote.estimate, false)
  assert.equal(cltQuote.miles, null)
  assert.equal(cltQuote.fareCents, 17544)
  assert.equal(cltQuote.discountCents, 0)
  assert.equal(cltQuote.depositCents, 4386) // Math.round(17544 * 0.25) = 4386

  // 4. CLT Student quote
  const cltStudentQuote = api.quoteRide(pickup, cltDropoff, true)
  assert.equal(cltStudentQuote.airport, 'CLT')
  assert.equal(cltStudentQuote.estimate, false)
  assert.equal(cltStudentQuote.miles, null)
  assert.equal(cltStudentQuote.fareCents, 15790)
  assert.equal(cltStudentQuote.discountCents, 1754)
  assert.equal(cltStudentQuote.depositCents, 3948) // Math.round(15790 * 0.25) = 3948
})

test('quoteRide calculates distance-based estimates for local campus trips with $0 deposit', async () => {
  const api = await import('./scheduleApi.ts')

  const pickup = { label: 'Douthit Hills Community', lat: 34.6805, lng: -82.8315 }
  const dropoff = { label: 'Clemson Memorial Stadium (Death Valley)', lat: 34.6788, lng: -82.8432 }

  // Non-student distance estimate
  const campusQuote = api.quoteRide(pickup, dropoff, false)
  assert.equal(campusQuote.airport, null)
  assert.equal(campusQuote.estimate, true)
  assert.equal(campusQuote.depositCents, 0, 'non-airport trips require $0 deposit')
  assert.ok(campusQuote.miles > 0, 'miles calculated from coordinates')
  assert.ok(campusQuote.fareCents > 0, 'fareCents calculated from distance')
  assert.equal(campusQuote.discountCents, 0)

  // Student distance estimate
  const studentQuote = api.quoteRide(pickup, dropoff, true)
  assert.equal(studentQuote.airport, null)
  assert.equal(studentQuote.estimate, true)
  assert.equal(studentQuote.depositCents, 0)
  assert.ok(studentQuote.fareCents < campusQuote.fareCents, 'student discount reduces distance fare')
  assert.ok(studentQuote.discountCents > 0)
})

test('riderIsStudent enforces authoritative confirmed Clemson student domains', async () => {
  const api = await import('./scheduleApi.ts')

  // Valid confirmed @clemson.edu
  assert.equal(
    api.riderIsStudent({ email: 'student@clemson.edu', email_confirmed_at: '2026-10-01T00:00:00Z' }),
    true,
    'confirmed @clemson.edu is student'
  )

  // Valid confirmed @g.clemson.edu
  assert.equal(
    api.riderIsStudent({ email: 'student@g.clemson.edu', confirmed_at: '2026-10-01T00:00:00Z' }),
    true,
    'confirmed @g.clemson.edu is student'
  )

  // Unconfirmed Clemson email
  assert.equal(
    api.riderIsStudent({ email: 'student@clemson.edu' }),
    false,
    'unconfirmed Clemson email is not granted student discount'
  )

  // Confirmed non-Clemson email
  assert.equal(
    api.riderIsStudent({ email: 'rider@gmail.com', email_confirmed_at: '2026-10-01T00:00:00Z' }),
    false,
    'confirmed non-Clemson address is not student'
  )

  // Null user
  assert.equal(api.riderIsStudent(null), false, 'null user is not student')
})

test('createScheduledTrip validates inputs and posts payload to backend endpoint', async () => {
  const api = await import('./scheduleApi.ts')
  const bridge = await import(supabaseUrl)
  initState()

  const pickup = { label: 'Clemson Amtrak Station', lat: 34.698, lng: -82.812 }
  const dropoff = { label: 'Greenville-Spartanburg International Airport (GSP)', lat: 34.895, lng: -82.218 }
  const pickupAt = new Date('2026-10-15T14:30:00.000Z')

  // 1. Supabase unconfigured error
  bridge.__setSupabase(null)
  await assert.rejects(
    () => api.createScheduledTrip({
      user: { id: 'usr_1' },
      pickup,
      dropoff,
      pickupAt,
      purpose: 'airport',
      weekdays: [],
    }),
    /Supabase is not configured/
  )

  // 2. Unauthenticated error
  const mockSb = mockSupabase(() => ({ data: null, error: null }))
  bridge.__setSupabase(mockSb)
  await assert.rejects(
    () => api.createScheduledTrip({
      user: null,
      pickup,
      dropoff,
      pickupAt,
      purpose: 'airport',
      weekdays: [],
    }),
    /Sign in required to schedule a ride/
  )

  // 3. Successful scheduling with standard tier
  state().authedResult = {
    trip: {
      id: 'trip_sched_100',
      status: 'scheduled',
      pickup_at: pickupAt.toISOString(),
      pickup_label: pickup.label,
      dropoff_label: dropoff.label,
    },
  }

  const created = await api.createScheduledTrip({
    user: { id: 'usr_99' },
    pickup,
    dropoff,
    pickupAt,
    purpose: 'airport',
    weekdays: ['Mon', 'Wed', 'Fri'],
    tier: 'standard',
  })

  assert.equal(created.id, 'trip_sched_100')
  assert.equal(created.status, 'scheduled')
  assert.equal(state().authedCalls.length, 1)

  const call = state().authedCalls[0]
  assert.equal(call.path, '/api/stripe-payment-methods?action=schedule-trip')
  assert.equal(call.options.method, 'POST')
  assert.deepEqual(call.options.body, {
    pickup,
    dropoff,
    pickupAt: '2026-10-15T14:30:00.000Z',
    purpose: 'airport',
    weekdays: ['Mon', 'Wed', 'Fri'],
    tier: 'standard',
  })

  // 4. Custom tier: tesla
  state().authedCalls = []
  state().authedResult = {
    trip: { id: 'trip_tesla_1', status: 'scheduled', pickup_at: pickupAt.toISOString(), pickup_label: pickup.label, dropoff_label: dropoff.label },
  }

  const teslaTrip = await api.createScheduledTrip({
    user: { id: 'usr_99' },
    pickup,
    dropoff,
    pickupAt,
    purpose: 'early_class',
    weekdays: [],
    tier: 'tesla',
  })

  assert.equal(teslaTrip.id, 'trip_tesla_1')
  assert.equal(state().authedCalls[0].options.body.tier, 'tesla')

  // 5. Backend returns missing trip id
  state().authedResult = { trip: null }
  await assert.rejects(
    () => api.createScheduledTrip({
      user: { id: 'usr_99' },
      pickup,
      dropoff,
      pickupAt,
      purpose: 'planned',
      weekdays: [],
    }),
    /Could not schedule ride/
  )

  // 6. Network / API error propagation
  state().authedError = new Error('Gateway Timeout')
  await assert.rejects(
    () => api.createScheduledTrip({
      user: { id: 'usr_99' },
      pickup,
      dropoff,
      pickupAt,
      purpose: 'planned',
      weekdays: [],
    }),
    /Gateway Timeout/
  )
})

test('listScheduledTrips queries Supabase trips table with ascending order and error handling', async () => {
  const api = await import('./scheduleApi.ts')
  const bridge = await import(supabaseUrl)
  initState()

  // 1. Supabase unconfigured returns empty array
  bridge.__setSupabase(null)
  const empty = await api.listScheduledTrips('rider_123')
  assert.deepEqual(empty, [])

  // 2. Successful query returns mapped rows
  const mockRows = [
    {
      id: 'trip_1',
      status: 'scheduled',
      pickup_label: 'Core Campus',
      dropoff_label: 'GSP',
      fare_cents: 6846,
      deposit_cents: 1712,
      pickup_at: '2026-10-10T10:00:00.000Z',
      scheduled_for: '2026-10-10',
      rider_note: null,
      tier: 'standard',
      created_at: '2026-10-01T00:00:00.000Z',
      metadata: { purpose: 'airport' },
    },
  ]

  const mockSb = mockSupabase((op) => {
    assert.equal(op.table, 'trips')
    assert.equal(op.action, 'select')
    assert.deepEqual(op.filters, [
      { kind: 'eq', column: 'rider_id', value: 'rider_123' },
      { kind: 'not', column: 'pickup_at', operator: 'is', value: null },
    ])
    assert.deepEqual(op.order, { column: 'pickup_at', ascending: true })
    assert.equal(op.limit, 30)
    return { data: mockRows, error: null }
  })

  bridge.__setSupabase(mockSb)
  const trips = await api.listScheduledTrips('rider_123')
  assert.deepEqual(trips, mockRows)

  // 3. Supabase query error propagation
  const errorSb = mockSupabase(() => ({
    data: null,
    error: { message: 'Database connection failed' },
  }))
  bridge.__setSupabase(errorSb)

  await assert.rejects(
    () => api.listScheduledTrips('rider_123'),
    /Database connection failed/
  )
})

test('cancelScheduledTrip marks trip canceled and enforces status restriction', async () => {
  const api = await import('./scheduleApi.ts')
  const bridge = await import(supabaseUrl)
  initState()

  // 1. Supabase unconfigured
  bridge.__setSupabase(null)
  await assert.rejects(
    () => api.cancelScheduledTrip('trip_999'),
    /Supabase is not configured/
  )

  // 2. Successful cancellation
  let updatePayload = null
  let updateFilters = null

  const mockSb = mockSupabase((op) => {
    assert.equal(op.table, 'trips')
    assert.equal(op.action, 'update')
    updatePayload = op.payload
    updateFilters = op.filters
    return { error: null }
  })

  bridge.__setSupabase(mockSb)
  await api.cancelScheduledTrip('trip_999')

  assert.equal(updatePayload.status, 'canceled')
  assert.ok(updatePayload.canceled_at, 'sets canceled_at timestamp')
  assert.deepEqual(updateFilters, [
    { kind: 'eq', column: 'id', value: 'trip_999' },
    { kind: 'in', column: 'status', values: ['scheduled', 'accepted'] },
  ])

  // 3. Supabase update error propagation
  const errorSb = mockSupabase(() => ({
    error: { message: 'Row locked by concurrent transaction' },
  }))
  bridge.__setSupabase(errorSb)

  await assert.rejects(
    () => api.cancelScheduledTrip('trip_999'),
    /Row locked by concurrent transaction/
  )
})
