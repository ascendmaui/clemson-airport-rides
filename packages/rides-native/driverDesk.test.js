import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptTrip,
  advanceTrip,
  declineTrip,
  formatCents,
  listPassedTripIds,
  loadDriverDesk,
  loadDriverProfile,
  loadEarnings,
  loadGameDay,
  loadRiderFix,
  loadTrip,
  loadVehicle,
  publishDriverCapacity,
  publishDriverLocation,
  riderFacingCard,
  setPriorityMode,
  setTeslaListing,
  subscribeTrips,
} from './driverDesk.js'
import { approvalGateMessage } from './syntheticOffers.js'
import { UNPAID_AIRPORT_DEPOSIT_ACCEPT_ERROR } from './tripTags.js'

/**
 * Small in-memory fake Supabase query builder.
 * Supports chainable: from, select, eq, neq, lte, gte, in, is, not, order, limit,
 * insert, upsert, update, delete, single, maybeSingle returning { data, error }.
 */
function createFakeSupabase(initialTables = {}, options = {}) {
  const tables = {}
  for (const [table, rows] of Object.entries(initialTables)) {
    tables[table] = rows.map((row) => ({ ...row }))
  }

  const channels = []

  function getTable(name) {
    if (!tables[name]) tables[name] = []
    return tables[name]
  }

  function matchFilter(row, filter) {
    const { type, col, val, op } = filter
    const rowVal = row[col]
    if (type === 'eq') return rowVal === val
    if (type === 'neq') return rowVal !== val
    if (type === 'in') return Array.isArray(val) && val.includes(rowVal)
    if (type === 'is') {
      if (val === null) return rowVal === null || rowVal === undefined
      return rowVal === val
    }
    if (type === 'not') {
      if (op === 'is' && val === null) return rowVal !== null && rowVal !== undefined
      return rowVal !== val
    }
    if (type === 'lte') {
      if (rowVal == null) return false
      return rowVal <= val
    }
    if (type === 'gte') {
      if (rowVal == null) return false
      return rowVal >= val
    }
    return true
  }

  function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every((filter) => matchFilter(row, filter)))
  }

  function applyOrder(rows, orders) {
    if (!orders.length) return rows
    return [...rows].sort((a, b) => {
      for (const { col, ascending } of orders) {
        const valA = a[col]
        const valB = b[col]
        if (valA === valB) continue
        if (valA == null) return ascending ? 1 : -1
        if (valB == null) return ascending ? -1 : 1
        if (typeof valA === 'number' && typeof valB === 'number') {
          return ascending ? valA - valB : valB - valA
        }
        const cmp = String(valA).localeCompare(String(valB))
        if (cmp !== 0) return ascending ? cmp : -cmp
      }
      return 0
    })
  }

  function executeQuery(state) {
    const { table, mode, filters, orders, limitCount, payload } = state
    const tableRows = getTable(table)

    if (typeof options.onError === 'function') {
      const intercepted = options.onError(table, state)
      if (intercepted) return { data: null, error: intercepted }
    }
    if (options.tableErrors?.[table]) {
      const err = options.tableErrors[table]
      const errorObj = typeof err === 'function' ? err(state) : err
      if (errorObj) return { data: null, error: errorObj }
    }

    if (mode === 'insert') {
      const items = Array.isArray(payload) ? payload : [payload]
      const inserted = items.map((item, index) => ({
        id: item.id || `${table}-${tableRows.length + index + 1}`,
        created_at: new Date().toISOString(),
        ...item,
      }))
      tableRows.push(...inserted)
      return { data: inserted, error: null }
    }

    if (mode === 'upsert') {
      const items = Array.isArray(payload) ? payload : [payload]
      const upserted = []
      for (const item of items) {
        let existingIndex = -1
        if (table === 'driver_status') {
          existingIndex = tableRows.findIndex((row) => row.driver_id === item.driver_id)
        } else if (table === 'driver_offer_passes') {
          existingIndex = tableRows.findIndex(
            (row) => row.driver_id === item.driver_id && row.trip_id === item.trip_id,
          )
        } else if (item.id) {
          existingIndex = tableRows.findIndex((row) => row.id === item.id)
        }

        if (existingIndex >= 0) {
          tableRows[existingIndex] = { ...tableRows[existingIndex], ...item }
          upserted.push(tableRows[existingIndex])
        } else {
          const row = {
            id: item.id || `${table}-${tableRows.length + 1}`,
            ...item,
          }
          tableRows.push(row)
          upserted.push(row)
        }
      }
      return { data: upserted, error: null }
    }

    if (mode === 'update') {
      const matched = applyFilters(tableRows, filters)
      for (const row of matched) {
        Object.assign(row, payload)
      }
      return { data: matched.map((row) => ({ ...row })), error: null }
    }

    if (mode === 'delete') {
      const matched = applyFilters(tableRows, filters)
      const matchedSet = new Set(matched)
      tables[table] = tableRows.filter((row) => !matchedSet.has(row))
      return { data: matched.map((row) => ({ ...row })), error: null }
    }

    // mode === 'select'
    let matched = applyFilters(tableRows, filters)
    matched = applyOrder(matched, orders)
    if (limitCount != null) {
      matched = matched.slice(0, limitCount)
    }
    return { data: matched.map((row) => ({ ...row })), error: null }
  }

  function createQueryBuilder(table) {
    const state = {
      table,
      mode: 'select',
      columns: '*',
      filters: [],
      orders: [],
      limitCount: null,
      payload: null,
    }

    const builder = {
      select(cols = '*') {
        state.columns = cols
        return builder
      },
      eq(col, val) {
        state.filters.push({ type: 'eq', col, val })
        return builder
      },
      neq(col, val) {
        state.filters.push({ type: 'neq', col, val })
        return builder
      },
      lte(col, val) {
        state.filters.push({ type: 'lte', col, val })
        return builder
      },
      gte(col, val) {
        state.filters.push({ type: 'gte', col, val })
        return builder
      },
      in(col, val) {
        state.filters.push({ type: 'in', col, val })
        return builder
      },
      is(col, val) {
        state.filters.push({ type: 'is', col, val })
        return builder
      },
      not(col, op, val) {
        state.filters.push({ type: 'not', col, op, val })
        return builder
      },
      order(col, { ascending = true } = {}) {
        state.orders.push({ col, ascending })
        return builder
      },
      limit(n) {
        state.limitCount = n
        return builder
      },
      insert(row) {
        state.mode = 'insert'
        state.payload = row
        return builder
      },
      upsert(row) {
        state.mode = 'upsert'
        state.payload = row
        return builder
      },
      update(patch) {
        state.mode = 'update'
        state.payload = patch
        return builder
      },
      delete() {
        state.mode = 'delete'
        return builder
      },
      async single() {
        const res = executeQuery(state)
        if (res.error) return res
        if (!res.data || res.data.length === 0) {
          return { data: null, error: new Error('JSON object requested, multiple (or no) rows returned') }
        }
        if (res.data.length > 1) {
          return { data: null, error: new Error('JSON object requested, multiple (or no) rows returned') }
        }
        return { data: res.data[0], error: null }
      },
      async maybeSingle() {
        const res = executeQuery(state)
        if (res.error) return res
        if (!res.data || res.data.length === 0) {
          return { data: null, error: null }
        }
        return { data: res.data[0], error: null }
      },
      then(resolve, reject) {
        try {
          const res = executeQuery(state)
          resolve(res)
        } catch (err) {
          reject(err)
        }
      },
    }

    return builder
  }

  const supabase = {
    _tables: tables,
    _channels: channels,
    auth: {
      async getUser() {
        if (options.authUserError) return { data: { user: null }, error: options.authUserError }
        return { data: { user: options.user || { id: 'default-driver' } }, error: null }
      },
      async getSession() {
        if (options.authSessionError) return { data: { session: null }, error: options.authSessionError }
        return { data: { session: { access_token: options.token || 'mock-token' } }, error: null }
      },
    },
    channel(name) {
      let changeHandler = null
      const ch = {
        name,
        on(event, config, callback) {
          changeHandler = callback
          return ch
        },
        subscribe() {
          channels.push({ name, ch, trigger: () => changeHandler?.() })
          return ch
        },
      }
      return ch
    },
    removeChannel(ch) {
      const idx = channels.findIndex((item) => item.ch === ch || item.name === ch?.name)
      if (idx !== -1) channels.splice(idx, 1)
    },
    async rpc(fn, args) {
      if (options.rpcHandlers && options.rpcHandlers[fn]) {
        return options.rpcHandlers[fn](args, tables)
      }
      if (options.rpcErrors && options.rpcErrors[fn]) {
        return { data: null, error: options.rpcErrors[fn] }
      }
      if (fn === 'accept_scheduled_trip') {
        const trip = (tables.trips || []).find((t) => t.id === args?.p_trip_id)
        if (trip) {
          trip.status = 'accepted'
          return { data: { id: trip.id, status: 'accepted' }, error: null }
        }
        return { data: null, error: new Error('Trip not found') }
      }
      return { data: null, error: null }
    },
    from(tableName) {
      return createQueryBuilder(tableName)
    },
  }

  return supabase
}

/**
 * Executes an async test block while mocking globalThis.fetch to avoid network requests.
 */
function withMockFetch(routes, fn) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url)
    for (const [pattern, handler] of Object.entries(routes)) {
      if (urlStr.includes(pattern)) {
        if (typeof handler === 'function') {
          return handler(urlStr, options)
        }
        return {
          ok: handler.status ? handler.status >= 200 && handler.status < 300 : true,
          status: handler.status || 200,
          statusText: handler.status === 200 ? 'OK' : 'Error',
          text: async () => JSON.stringify(handler.body !== undefined ? handler.body : handler),
          json: async () => (handler.body !== undefined ? handler.body : handler),
        }
      }
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({}),
      json: async () => ({}),
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = originalFetch
    })
}

// ---------------------------------------------------------------------------
// 1. formatCents
// ---------------------------------------------------------------------------
test('formatCents converts cents to formatted dollar string', () => {
  assert.equal(formatCents(1250), '$12.50')
  assert.equal(formatCents(0), '$0.00')
  assert.equal(formatCents(-350), '-$3.50')
  assert.equal(formatCents('4200'), '$42.00')
  assert.equal(formatCents(null), '$0.00')
  assert.equal(formatCents(undefined), '$0.00')
  assert.equal(formatCents('invalid'), '$0.00')
})

// ---------------------------------------------------------------------------
// 2. riderFacingCard
// ---------------------------------------------------------------------------
test('riderFacingCard formats complete profile and vehicle card', () => {
  const card = riderFacingCard({
    profile: {
      full_name: 'Alex Hunter',
      phone: '864-555-0199',
      rating_avg: 4.88,
      rating_count: 50,
      student_verified_at: '2025-01-01T00:00:00.000Z',
    },
    vehicle: {
      make: 'Tesla',
      model: 'Model Y',
      color: 'White',
      plate: 'CLEM-1',
      seats: 4,
      is_tesla: true,
      tier: 'tesla_self_driving',
    },
    online: true,
  })

  assert.deepEqual(card, {
    name: 'Alex Hunter',
    phone: '864-555-0199',
    ratingAvg: 4.88,
    ratingCount: 50,
    studentVerified: true,
    vehicleLabel: 'White Tesla Model Y',
    plate: 'CLEM-1',
    isTesla: true,
    tier: 'tesla_self_driving',
    online: true,
    seats: 4,
  })
})

test('riderFacingCard provides safe defaults when input is missing or empty', () => {
  const card = riderFacingCard({ profile: null, vehicle: null, online: false })
  assert.deepEqual(card, {
    name: 'Driver',
    phone: null,
    ratingAvg: null,
    ratingCount: 0,
    studentVerified: false,
    vehicleLabel: 'Vehicle TBD',
    plate: null,
    isTesla: false,
    tier: 'standard',
    online: false,
    seats: null,
  })

  // Fixed [t2]: if vehicle is an empty object or has no color/make/model, vehicleLabel falls back to 'Vehicle TBD'
  const emptyVehicleCard = riderFacingCard({ profile: null, vehicle: {}, online: false })
  assert.equal(emptyVehicleCard.vehicleLabel, 'Vehicle TBD')

  const sparseVehicleCard = riderFacingCard({ profile: null, vehicle: { id: 'v-1' }, online: false })
  assert.equal(sparseVehicleCard.vehicleLabel, 'Vehicle TBD')
})

// ---------------------------------------------------------------------------
// 3. loadGameDay
// ---------------------------------------------------------------------------
test('loadGameDay returns null when supabase client is missing', async () => {
  const result = await loadGameDay(null)
  assert.equal(result, null)
})

test('loadGameDay returns active event matching the time window ordered by surge', async () => {
  const supabase = createFakeSupabase({
    game_day_events: [
      {
        id: 'gameday-low',
        title: 'Low Surge Event',
        surge_multiplier: 1.25,
        pickup_zone_label: 'Zone B',
        active: true,
        starts_at: '2020-01-01T00:00:00.000Z',
        ends_at: '2099-01-01T00:00:00.000Z',
      },
      {
        id: 'gameday-high',
        title: 'High Surge Event',
        surge_multiplier: 2.0,
        pickup_zone_label: 'Memorial Stadium',
        active: true,
        starts_at: '2020-01-01T00:00:00.000Z',
        ends_at: '2099-01-01T00:00:00.000Z',
      },
    ],
  })

  const event = await loadGameDay(supabase)
  assert.ok(event)
  assert.equal(event.id, 'gameday-high')
  assert.equal(event.title, 'High Surge Event')
  assert.equal(event.surge_multiplier, 2.0)
})

test('loadGameDay returns null when events are inactive or expired', async () => {
  const supabase = createFakeSupabase({
    game_day_events: [
      {
        id: 'gameday-expired',
        title: 'Past Event',
        surge_multiplier: 1.5,
        active: true,
        starts_at: '2020-01-01T00:00:00.000Z',
        ends_at: '2020-01-02T00:00:00.000Z',
      },
      {
        id: 'gameday-inactive',
        title: 'Inactive Event',
        surge_multiplier: 1.5,
        active: false,
        starts_at: '2020-01-01T00:00:00.000Z',
        ends_at: '2099-01-01T00:00:00.000Z',
      },
    ],
  })

  const event = await loadGameDay(supabase)
  assert.equal(event, null)
})

test('loadGameDay returns null on database error without throwing', async () => {
  const supabase = createFakeSupabase(
    {},
    {
      tableErrors: {
        game_day_events: { message: 'Database connection failed' },
      },
    },
  )

  const event = await loadGameDay(supabase)
  assert.equal(event, null)
})

// ---------------------------------------------------------------------------
// 4. loadVehicle
// ---------------------------------------------------------------------------
test('loadVehicle returns vehicle row for driver', async () => {
  const supabase = createFakeSupabase({
    vehicles: [
      {
        id: 'v-1',
        driver_id: 'driver-123',
        make: 'Toyota',
        model: 'Camry',
        color: 'Silver',
        plate: 'SC-999',
        seats: 4,
        is_tesla: false,
        autonomous_capable: false,
        tier: 'standard',
      },
    ],
  })

  const vehicle = await loadVehicle(supabase, 'driver-123')
  assert.ok(vehicle)
  assert.equal(vehicle.id, 'v-1')
  assert.equal(vehicle.make, 'Toyota')
  assert.equal(vehicle.model, 'Camry')
})

test('loadVehicle returns null when client or driverId is missing or vehicle not found', async () => {
  const supabase = createFakeSupabase()
  assert.equal(await loadVehicle(null, 'driver-123'), null)
  assert.equal(await loadVehicle(supabase, null), null)
  assert.equal(await loadVehicle(supabase, 'non-existent-driver'), null)
})

test('loadVehicle throws error when query fails', async () => {
  const supabase = createFakeSupabase(
    {},
    {
      tableErrors: {
        vehicles: { message: 'Permission denied on vehicles' },
      },
    },
  )

  await assert.rejects(
    () => loadVehicle(supabase, 'driver-123'),
    /Permission denied on vehicles/,
  )
})

// ---------------------------------------------------------------------------
// 5. loadDriverProfile
// ---------------------------------------------------------------------------
test('loadDriverProfile returns profile row on happy path', async () => {
  const supabase = createFakeSupabase({
    profiles: [
      {
        id: 'driver-123',
        full_name: 'Jordan Smith',
        phone: '864-555-4321',
        rating_avg: 4.92,
        rating_count: 18,
        student_verified_at: '2025-09-01T00:00:00.000Z',
        avatar_url: 'https://example.com/avatar.jpg',
      },
    ],
  })

  const profile = await loadDriverProfile(supabase, 'driver-123')
  assert.ok(profile)
  assert.equal(profile.full_name, 'Jordan Smith')
  assert.equal(profile.rating_avg, 4.92)
})

test('loadDriverProfile returns null when client or driverId is missing or row not found', async () => {
  const supabase = createFakeSupabase()
  assert.equal(await loadDriverProfile(null, 'driver-123'), null)
  assert.equal(await loadDriverProfile(supabase, null), null)
  assert.equal(await loadDriverProfile(supabase, 'non-existent-driver'), null)
})

test('loadDriverProfile retries with narrow columns on schema cache error', async () => {
  const supabase = createFakeSupabase(
    {
      profiles: [
        {
          id: 'driver-123',
          full_name: 'Jordan Smith',
          phone: '864-555-4321',
          avatar_url: 'https://example.com/avatar.jpg',
        },
      ],
    },
    {
      onError(table, state) {
        if (table === 'profiles' && state.columns.includes('rating_avg')) {
          return { message: 'column rating_avg does not exist in schema cache' }
        }
        return null
      },
    },
  )

  const profile = await loadDriverProfile(supabase, 'driver-123')
  assert.ok(profile)
  assert.equal(profile.id, 'driver-123')
  assert.equal(profile.full_name, 'Jordan Smith')
})

test('loadDriverProfile throws when query fails with non-schema error', async () => {
  const supabase = createFakeSupabase(
    {},
    {
      tableErrors: {
        profiles: { message: 'Connection timeout on profiles' },
      },
    },
  )

  await assert.rejects(
    () => loadDriverProfile(supabase, 'driver-123'),
    /Connection timeout on profiles/,
  )
})

// ---------------------------------------------------------------------------
// 6. setPriorityMode
// ---------------------------------------------------------------------------
test('setPriorityMode throws when supabase or driverId is missing', async () => {
  const supabase = createFakeSupabase()
  await assert.rejects(() => setPriorityMode(null, 'driver-1', true), /Sign in required/)
  await assert.rejects(() => setPriorityMode(supabase, null, true), /Sign in required/)
})

test('setPriorityMode upserts priority_mode flag in driver_status', async () => {
  const supabase = createFakeSupabase()
  await setPriorityMode(supabase, 'driver-1', true)

  const row = supabase._tables.driver_status.find((r) => r.driver_id === 'driver-1')
  assert.ok(row)
  assert.equal(row.priority_mode, true)
  assert.ok(typeof row.updated_at === 'string')

  await setPriorityMode(supabase, 'driver-1', false)
  const updated = supabase._tables.driver_status.find((r) => r.driver_id === 'driver-1')
  assert.equal(updated.priority_mode, false)
})

test('setPriorityMode throws on database error', async () => {
  const supabase = createFakeSupabase(
    {},
    {
      tableErrors: {
        driver_status: { message: 'RLS violation on driver_status' },
      },
    },
  )

  await assert.rejects(
    () => setPriorityMode(supabase, 'driver-1', true),
    /RLS violation on driver_status/,
  )
})

// ---------------------------------------------------------------------------
// 7. publishDriverLocation
// ---------------------------------------------------------------------------
test('publishDriverLocation ignores missing arguments or non-finite coordinates', async () => {
  const supabase = createFakeSupabase()
  await publishDriverLocation(null, 'driver-1', { lat: 34.68, lng: -82.83 })
  await publishDriverLocation(supabase, null, { lat: 34.68, lng: -82.83 })
  await publishDriverLocation(supabase, 'driver-1', { lat: NaN, lng: -82.83 })
  await publishDriverLocation(supabase, 'driver-1', { lat: 34.68, lng: null })

  assert.equal(supabase._tables.driver_status?.length || 0, 0)
})

test('publishDriverLocation upserts driver location and normalizes heading', async () => {
  const supabase = createFakeSupabase()
  await publishDriverLocation(supabase, 'driver-1', {
    lat: 34.6834,
    lng: -82.8374,
    heading: '180.5',
    online: true,
  })

  const row = supabase._tables.driver_status.find((r) => r.driver_id === 'driver-1')
  assert.ok(row)
  assert.equal(row.lat, 34.6834)
  assert.equal(row.lng, -82.8374)
  assert.equal(row.heading, 180.5)
  assert.equal(row.online, true)

  // Invalid heading becomes null
  await publishDriverLocation(supabase, 'driver-1', {
    lat: 34.6834,
    lng: -82.8374,
    heading: 'invalid-heading',
    online: false,
  })
  const updated = supabase._tables.driver_status.find((r) => r.driver_id === 'driver-1')
  assert.equal(updated.heading, null)
  assert.equal(updated.online, false)
})

test('publishDriverLocation throws on database error', async () => {
  const supabase = createFakeSupabase(
    {},
    {
      tableErrors: {
        driver_status: { message: 'Database unavailable' },
      },
    },
  )

  await assert.rejects(
    () => publishDriverLocation(supabase, 'driver-1', { lat: 34.68, lng: -82.83 }),
    /Database unavailable/,
  )
})

// ---------------------------------------------------------------------------
// 8. setTeslaListing
// ---------------------------------------------------------------------------
test('setTeslaListing throws when driver has no vehicle in onboarding', async () => {
  const supabase = createFakeSupabase()
  await assert.rejects(
    () => setTeslaListing(supabase, 'driver-no-car', { enabled: true }),
    /Add your vehicle in driver onboarding before listing a Tesla/,
  )
})

test('setTeslaListing updates vehicle tier and attributes when enabled', async () => {
  const supabase = createFakeSupabase({
    vehicles: [
      {
        id: 'v-10',
        driver_id: 'driver-1',
        make: 'Honda',
        model: 'Civic',
        tier: 'standard',
        is_tesla: false,
      },
    ],
  })

  const updated = await setTeslaListing(supabase, 'driver-1', { enabled: true, claimModel3: true })
  assert.equal(updated.is_tesla, true)
  assert.equal(updated.tier, 'tesla_self_driving')
  assert.equal(updated.autonomous_capable, false)
  assert.equal(updated.make, 'Tesla')
  assert.equal(updated.model, 'Model 3')

  // Turning off resets tier and is_tesla without modifying make/model
  const reverted = await setTeslaListing(supabase, 'driver-1', { enabled: false })
  assert.equal(reverted.is_tesla, false)
  assert.equal(reverted.tier, 'standard')
  assert.equal(reverted.make, 'Tesla')
})

test('setTeslaListing throws on update query error', async () => {
  const supabase = createFakeSupabase(
    {
      vehicles: [{ id: 'v-10', driver_id: 'driver-1' }],
    },
    {
      onError(table, state) {
        if (table === 'vehicles' && state.mode === 'update') {
          return { message: 'Failed to update vehicle listing' }
        }
        return null
      },
    },
  )

  await assert.rejects(
    () => setTeslaListing(supabase, 'driver-1', { enabled: true }),
    /Failed to update vehicle listing/,
  )
})

// ---------------------------------------------------------------------------
// 9. subscribeTrips
// ---------------------------------------------------------------------------
test('subscribeTrips handles missing supabase gracefully', () => {
  const unsubscribe = subscribeTrips(null, () => {})
  assert.equal(typeof unsubscribe, 'function')
  unsubscribe() // should not throw
})

test('subscribeTrips creates channel and triggers callback on change', () => {
  const supabase = createFakeSupabase()
  let callCount = 0
  const unsubscribe = subscribeTrips(supabase, () => {
    callCount += 1
  })

  assert.equal(supabase._channels.length, 1)
  assert.match(supabase._channels[0].name, /^driver-trips-/)

  supabase._channels[0].trigger()
  assert.equal(callCount, 1)

  unsubscribe()
  assert.equal(supabase._channels.length, 0)
})

// ---------------------------------------------------------------------------
// 10. listPassedTripIds
// ---------------------------------------------------------------------------
test('listPassedTripIds returns empty array on missing arguments or error', async () => {
  const supabase = createFakeSupabase(
    {},
    {
      tableErrors: {
        driver_offer_passes: { message: 'Table does not exist' },
      },
    },
  )

  assert.deepEqual(await listPassedTripIds(null, 'driver-1'), [])
  assert.deepEqual(await listPassedTripIds(supabase, null), [])
  assert.deepEqual(await listPassedTripIds(supabase, 'driver-1'), [])
})

test('listPassedTripIds returns list of passed trip ids', async () => {
  const supabase = createFakeSupabase({
    driver_offer_passes: [
      { driver_id: 'driver-1', trip_id: 'trip-101' },
      { driver_id: 'driver-1', trip_id: 'trip-102' },
      { driver_id: 'driver-2', trip_id: 'trip-999' },
    ],
  })

  const passed = await listPassedTripIds(supabase, 'driver-1')
  assert.deepEqual(passed, ['trip-101', 'trip-102'])
})

// ---------------------------------------------------------------------------
// 11. publishDriverCapacity
// ---------------------------------------------------------------------------
test('publishDriverCapacity returns empty state when client or driverId is missing', async () => {
  const supabase = createFakeSupabase()
  assert.deepEqual(await publishDriverCapacity(null, 'driver-1', 4), { seats: null, stored: false })
  assert.deepEqual(await publishDriverCapacity(supabase, null, 4), { seats: null, stored: false })
})

test('publishDriverCapacity stores valid seat count in driver_status', async () => {
  const supabase = createFakeSupabase()
  const res = await publishDriverCapacity(supabase, 'driver-1', 4)
  assert.deepEqual(res, { seats: 4, stored: true })

  const row = supabase._tables.driver_status.find((r) => r.driver_id === 'driver-1')
  assert.equal(row.seats, 4)
})

test('publishDriverCapacity handles schema cache error by reporting stored: false', async () => {
  const supabase = createFakeSupabase(
    {},
    {
      tableErrors: {
        driver_status: { message: 'column seats does not exist in schema cache' },
      },
    },
  )

  const res = await publishDriverCapacity(supabase, 'driver-1', 3)
  assert.deepEqual(res, { seats: 3, stored: false })
})

test('publishDriverCapacity throws on unexpected database error', async () => {
  const supabase = createFakeSupabase(
    {},
    {
      tableErrors: {
        driver_status: { message: 'Network connection broken' },
      },
    },
  )

  await assert.rejects(
    () => publishDriverCapacity(supabase, 'driver-1', 4),
    /Network connection broken/,
  )
})

test('publishDriverCapacity clamps 0 or non-numeric seats to 1 due to Math.max(1, ...)', async () => {
  // BUG?: count = Math.max(1, Math.round(Number(seats) || 0)) is always >= 1, so if (!count) is unreachable; passing 0 or null seats results in count = 1 rather than clearing seats
  const supabase = createFakeSupabase()
  const res = await publishDriverCapacity(supabase, 'driver-1', 0)
  assert.deepEqual(res, { seats: 1, stored: true })
})

// ---------------------------------------------------------------------------
// 12. acceptTrip
// ---------------------------------------------------------------------------
test('acceptTrip validates arguments and synthetic trip status', async () => {
  const supabase = createFakeSupabase()
  await assert.rejects(() => acceptTrip(supabase, null, 'driver-1'), /Missing ride/)
  await assert.rejects(() => acceptTrip(supabase, {}, 'driver-1'), /Missing ride/)
  await assert.rejects(
    () => acceptTrip(supabase, { id: 'synthetic-123' }, 'driver-1'),
    /Finish approval to go online/,
  )
  await assert.rejects(
    () => acceptTrip(supabase, { id: 'trip-1', isSynthetic: true }, 'driver-1'),
    /Finish approval to go online/,
  )
})

test('acceptTrip rejects unpaid airport deposit trips', async () => {
  const supabase = createFakeSupabase({
    trips: [
      {
        id: 'airport-unpaid',
        status: 'searching',
        deposit_cents: 2500,
        metadata: { purpose: 'airport' },
      },
    ],
  })

  await assert.rejects(
    () => acceptTrip(supabase, { id: 'airport-unpaid', status: 'searching' }, 'driver-1'),
    new RegExp(UNPAID_AIRPORT_DEPOSIT_ACCEPT_ERROR),
  )
})

test('acceptTrip rejects when driver onboarding is not approved', async () => {
  const supabase = createFakeSupabase({
    trips: [{ id: 'trip-1', status: 'searching' }],
    driver_applications: [{ profile_id: 'driver-1', onboarding_status: 'pending' }],
  })

  await assert.rejects(
    () => acceptTrip(supabase, { id: 'trip-1', status: 'searching' }, 'driver-1'),
    /Finish approval to go online\. Your account is still under review\./,
  )
})

test('acceptTrip rejects on-demand ride if driver is offline', async () => {
  const supabase = createFakeSupabase({
    trips: [{ id: 'trip-1', status: 'searching' }],
    driver_applications: [{ profile_id: 'driver-1', onboarding_status: 'approved' }],
    driver_status: [{ driver_id: 'driver-1', online: false }],
  })

  await assert.rejects(
    () => acceptTrip(supabase, { id: 'trip-1', status: 'searching' }, 'driver-1'),
    /Go online before accepting a ride\./,
  )
})

test('acceptTrip accepts scheduled trip via rpc accept_scheduled_trip', async () => {
  const supabase = createFakeSupabase({
    trips: [{ id: 'trip-sched', status: 'scheduled' }],
    driver_applications: [{ profile_id: 'driver-1', onboarding_status: 'approved' }],
    driver_status: [{ driver_id: 'driver-1', online: false }], // scheduled trips do not require online presence
  })

  const res = await acceptTrip(supabase, { id: 'trip-sched', status: 'scheduled' }, 'driver-1')
  assert.deepEqual(res, { id: 'trip-sched', status: 'accepted' })
})

test('acceptTrip accepts on-demand trip and logs trip_events', async () => {
  const supabase = createFakeSupabase({
    trips: [{ id: 'trip-od', status: 'offered' }],
    driver_applications: [{ profile_id: 'driver-1', onboarding_status: 'approved' }],
    driver_status: [{ driver_id: 'driver-1', online: true }],
  })

  const res = await acceptTrip(supabase, { id: 'trip-od', status: 'offered' }, 'driver-1')
  assert.equal(res.id, 'trip-od')
  assert.equal(res.status, 'accepted')
  assert.equal(res.driver_id, 'driver-1')
  assert.ok(typeof res.accepted_at === 'string')

  const event = supabase._tables.trip_events?.find((e) => e.trip_id === 'trip-od')
  assert.ok(event)
  assert.equal(event.kind, 'accepted')
  assert.equal(event.payload?.driver_id, 'driver-1')
})

test('acceptTrip throws when on-demand ride is no longer available', async () => {
  const supabase = createFakeSupabase({
    trips: [{ id: 'trip-od', status: 'in_progress', driver_id: 'other-driver' }],
    driver_applications: [{ profile_id: 'driver-1', onboarding_status: 'approved' }],
    driver_status: [{ driver_id: 'driver-1', online: true }],
  })

  await assert.rejects(
    () => acceptTrip(supabase, { id: 'trip-od', status: 'offered' }, 'driver-1'),
    /That ride is no longer available/,
  )
})

test('acceptTrip checks trip.status instead of fresh.status for scheduled routing', async () => {
  // BUG?: acceptTrip checks trip.status instead of fresh.status for acceptNeedsDriverOnline and scheduled branch routing
  const supabase = createFakeSupabase({
    trips: [{ id: 'trip-conflict', status: 'searching' }], // DB has searching
    driver_applications: [{ profile_id: 'driver-1', onboarding_status: 'approved' }],
    driver_status: [{ driver_id: 'driver-1', online: false }],
  })

  // Passing trip.status = 'scheduled' bypasses online check and routes to RPC
  let rpcCalled = false
  supabase.rpc = async (fn, args) => {
    if (fn === 'accept_scheduled_trip') {
      rpcCalled = true
      return { data: { id: args.p_trip_id, status: 'accepted' }, error: null }
    }
    return { data: null, error: null }
  }

  const res = await acceptTrip(supabase, { id: 'trip-conflict', status: 'scheduled' }, 'driver-1')
  assert.equal(rpcCalled, true)
  assert.equal(res.status, 'accepted')
})

// ---------------------------------------------------------------------------
// 13. declineTrip
// ---------------------------------------------------------------------------
test('declineTrip returns disposition leave when trip has no id or is scheduled', async () => {
  const supabase = createFakeSupabase()
  assert.deepEqual(await declineTrip(supabase, null), { disposition: 'leave' })
  assert.deepEqual(await declineTrip(supabase, { id: null }), { disposition: 'leave' })
  assert.deepEqual(await declineTrip(supabase, { id: 'sched-1', status: 'scheduled' }), {
    disposition: 'leave',
  })
})

test('declineTrip releases offered ride back to open pool and records pass', async () => {
  const supabase = createFakeSupabase({
    trips: [{ id: 'trip-offered', status: 'offered', driver_id: null }],
  })

  const res = await declineTrip(supabase, { id: 'trip-offered', status: 'offered' }, 'driver-1')
  assert.deepEqual(res, { disposition: 'release', passed: true, released: true })

  const pass = supabase._tables.driver_offer_passes.find((p) => p.trip_id === 'trip-offered')
  assert.ok(pass)
  assert.equal(pass.driver_id, 'driver-1')

  const event = supabase._tables.trip_events.find((e) => e.trip_id === 'trip-offered')
  assert.ok(event)
  assert.equal(event.kind, 'released')
})

test('declineTrip releases searching ride by recording pass without rewriting trip', async () => {
  const supabase = createFakeSupabase({
    trips: [{ id: 'trip-searching', status: 'searching' }],
  })

  const res = await declineTrip(supabase, { id: 'trip-searching', status: 'searching' }, 'driver-1')
  assert.deepEqual(res, { disposition: 'release', passed: true, released: false })

  const pass = supabase._tables.driver_offer_passes.find((p) => p.trip_id === 'trip-searching')
  assert.ok(pass)
})

test('declineTrip cancels requested ride and records canceled trip_event', async () => {
  const supabase = createFakeSupabase({
    trips: [{ id: 'trip-req', status: 'requested' }],
  })

  const res = await declineTrip(supabase, { id: 'trip-req', status: 'requested' }, 'driver-1')
  assert.deepEqual(res, { disposition: 'cancel' })

  const trip = supabase._tables.trips.find((t) => t.id === 'trip-req')
  assert.equal(trip.status, 'canceled')
  assert.ok(typeof trip.canceled_at === 'string')

  const event = supabase._tables.trip_events.find((e) => e.trip_id === 'trip-req')
  assert.ok(event)
  assert.equal(event.kind, 'canceled')
})

test('declineTrip handles string tripId by defaulting to requested and cancelling', async () => {
  // BUG?: passing a string tripId to declineTrip assumes status 'requested' which cancels the trip instead of releasing it to the pool
  const supabase = createFakeSupabase({
    trips: [{ id: 'trip-str', status: 'requested' }],
  })

  const res = await declineTrip(supabase, 'trip-str', 'driver-1')
  assert.deepEqual(res, { disposition: 'cancel' })
})

// ---------------------------------------------------------------------------
// 14. loadRiderFix
// ---------------------------------------------------------------------------
test('loadRiderFix returns null when arguments are missing or query fails', async () => {
  const supabase = createFakeSupabase(
    {},
    {
      tableErrors: {
        location_shares: { message: 'Error' },
      },
    },
  )

  assert.equal(await loadRiderFix(null, 'trip-1'), null)
  assert.equal(await loadRiderFix(supabase, null), null)
  assert.equal(await loadRiderFix(supabase, 'trip-1'), null)
})

test('loadRiderFix returns rider live coordinates from location_points', async () => {
  const supabase = createFakeSupabase({
    location_shares: [{ id: 'share-1', trip_id: 'trip-1', active: true }],
    location_points: [
      { share_id: 'share-1', lat: 34.685, lng: -82.835, created_at: '2026-09-24T12:00:00.000Z' },
    ],
  })

  const fix = await loadRiderFix(supabase, 'trip-1')
  assert.deepEqual(fix, {
    latitude: 34.685,
    longitude: -82.835,
    updatedAt: '2026-09-24T12:00:00.000Z',
  })
})

test('loadRiderFix returns null when share is inactive or coordinates are non-finite', async () => {
  const supabase = createFakeSupabase({
    location_shares: [{ id: 'share-1', trip_id: 'trip-inactive', active: false }],
    location_points: [{ share_id: 'share-1', lat: 'invalid', lng: -82.835 }],
  })

  assert.equal(await loadRiderFix(supabase, 'trip-inactive'), null)
})

// ---------------------------------------------------------------------------
// 15. advanceTrip
// ---------------------------------------------------------------------------
test('advanceTrip throws when next status is invalid or trip is missing', async () => {
  const supabase = createFakeSupabase()
  await assert.rejects(() => advanceTrip(supabase, null, 'driver-1'), /This trip cannot be advanced/)
  await assert.rejects(
    () => advanceTrip(supabase, { id: 'trip-1', status: 'completed' }, 'driver-1'),
    /This trip cannot be advanced/,
  )
})

test('advanceTrip advances accepted to arriving', async () => {
  const supabase = createFakeSupabase({
    trips: [{ id: 'trip-adv', status: 'accepted', driver_id: 'driver-1' }],
  })

  const res = await advanceTrip(supabase, { id: 'trip-adv', status: 'accepted' }, 'driver-1')
  assert.equal(res.status, 'arriving')

  const event = supabase._tables.trip_events.find((e) => e.trip_id === 'trip-adv')
  assert.ok(event)
  assert.equal(event.kind, 'arriving')
})

test('advanceTrip advances arriving to arrived via API with Supabase fallback on network error', async () => {
  const supabase = createFakeSupabase({
    trips: [{ id: 'trip-arr', status: 'arriving', driver_id: 'driver-1' }],
  })

  // Happy path via API
  await withMockFetch(
    {
      '/api/driver?action=wait': { status: 200, body: { ok: true } },
    },
    async () => {
      const res = await advanceTrip(supabase, { id: 'trip-arr', status: 'arriving' }, 'driver-1')
      assert.deepEqual(res, { status: 'arrived' })
    },
  )

  // Network error fallback to Supabase direct update
  await withMockFetch(
    {
      '/api/driver?action=wait': () => {
        const err = new Error('Network failed')
        err.network = true
        throw err
      },
    },
    async () => {
      const res = await advanceTrip(supabase, { id: 'trip-arr', status: 'arriving' }, 'driver-1')
      assert.deepEqual(res, { status: 'arrived' })
    },
  )
})

test('advanceTrip advances arrived to in_progress', async () => {
  const supabase = createFakeSupabase({
    trips: [{ id: 'trip-prog', status: 'arrived', driver_id: 'driver-1' }],
  })

  const res = await advanceTrip(supabase, { id: 'trip-prog', status: 'arrived' }, 'driver-1')
  assert.equal(res.status, 'in_progress')
})

test('advanceTrip advances in_progress to completed and attaches settle receipt', async () => {
  const supabase = createFakeSupabase({
    trips: [{ id: 'trip-done', status: 'in_progress', driver_id: 'driver-1' }],
  })

  await withMockFetch(
    {
      '/api/stripe-payment-methods?action=settle': {
        status: 200,
        body: { payout: { status: 'pending', amountCents: 1800 } },
      },
    },
    async () => {
      const res = await advanceTrip(supabase, { id: 'trip-done', status: 'in_progress' }, 'driver-1')
      assert.equal(res.status, 'completed')
      assert.ok(res.completed_at)
      assert.deepEqual(res.settle, { payout: { status: 'pending', amountCents: 1800 } })
    },
  )
})

test('advanceTrip translates payment_required error when completing', async () => {
  const supabase = createFakeSupabase(
    {
      trips: [{ id: 'trip-fail', status: 'in_progress', driver_id: 'driver-1' }],
    },
    {
      tableErrors: {
        trips: { message: 'payment_required by rider bank' },
      },
    },
  )

  await withMockFetch(
    {
      '/api/stripe-payment-methods?action=settle': { status: 200, body: {} },
    },
    async () => {
      await assert.rejects(
        () => advanceTrip(supabase, { id: 'trip-fail', status: 'in_progress' }, 'driver-1'),
        /Payment is still required before this trip can complete\./,
      )
    },
  )
})

// ---------------------------------------------------------------------------
// 16. loadTrip
// ---------------------------------------------------------------------------
test('loadTrip returns null on missing arguments or non-existent trip', async () => {
  const supabase = createFakeSupabase()
  assert.equal(await loadTrip(null, 'trip-1'), null)
  assert.equal(await loadTrip(supabase, null), null)
  assert.equal(await loadTrip(supabase, 'trip-missing'), null)
})

test('loadTrip returns driver card for existing trip', async () => {
  const supabase = createFakeSupabase({
    trips: [
      {
        id: 'trip-card',
        status: 'searching',
        pickup_label: 'Sikes Hall',
        dropoff_label: 'GSP Airport',
        fare_cents: 4500,
      },
    ],
  })

  const card = await loadTrip(supabase, 'trip-card', 'driver-1')
  assert.ok(card)
  assert.equal(card.id, 'trip-card')
  assert.equal(card.pickupLabel, 'Sikes Hall')
  assert.equal(card.dropoffLabel, 'GSP Airport')
  assert.equal(card.fareCents, 4500)
})

test('loadTrip returns driver card regardless of driverId mismatch', async () => {
  // BUG?: loadTrip checks if driverId !== row.driver_id but returns toDriverCard(row) in both branches, making the condition a no-op
  const supabase = createFakeSupabase({
    trips: [
      {
        id: 'trip-mismatch',
        status: 'canceled',
        driver_id: 'other-driver',
        pickup_label: 'Douthit Hills',
      },
    ],
  })

  const card = await loadTrip(supabase, 'trip-mismatch', 'my-driver-id')
  assert.ok(card)
  assert.equal(card.id, 'trip-mismatch')
})

// ---------------------------------------------------------------------------
// 17. loadDriverDesk
// ---------------------------------------------------------------------------
test('loadDriverDesk returns default shape when supabase or driverId is missing', async () => {
  const supabase = createFakeSupabase()
  const desk = await loadDriverDesk(null, 'driver-1')
  assert.deepEqual(desk, {
    offers: [],
    scheduledOpen: [],
    upcoming: [],
    active: null,
    online: false,
    priority: false,
    vehicle: null,
    gameDay: null,
    profile: null,
  })

  // BUG?: loadDriverDesk returns a shape missing 'facing', 'lat', 'lng', and 'warning' keys when driverId or supabase is missing
  assert.equal('facing' in desk, false)
  assert.equal('warning' in desk, false)
})

test('loadDriverDesk aggregates offers, scheduled, upcoming, active, and driver status', async () => {
  const supabase = createFakeSupabase({
    driver_status: [
      { driver_id: 'driver-1', online: true, priority_mode: true, lat: 34.68, lng: -82.84 },
    ],
    vehicles: [
      { id: 'v-1', driver_id: 'driver-1', make: 'Tesla', model: 'Model 3', is_tesla: true },
    ],
    profiles: [
      { id: 'driver-1', full_name: 'Driver One', phone: '864-555-1111' },
    ],
    driver_applications: [
      { profile_id: 'driver-1', onboarding_status: 'approved' },
    ],
    driver_offer_passes: [
      { driver_id: 'driver-1', trip_id: 'trip-passed' },
    ],
    trips: [
      // 1. Open searching trip (due now)
      { id: 'trip-open', status: 'searching', pickup_label: 'Tillman Hall', pickup_at: null },
      // 2. Passed trip (should be filtered out of offers)
      { id: 'trip-passed', status: 'searching', pickup_label: 'Hendrix Center', pickup_at: null },
      // 3. Unpaid airport trip (should be filtered out of offers)
      { id: 'trip-airport-unpaid', status: 'searching', deposit_cents: 2000, metadata: { purpose: 'airport' } },
      // 4. Open scheduled trip
      { id: 'trip-sched', status: 'scheduled', driver_id: null, pickup_label: 'Core Campus', pickup_at: '2099-01-01T00:00:00.000Z' },
      // 5. Driver active trip (due now)
      { id: 'trip-active', driver_id: 'driver-1', status: 'accepted', pickup_label: 'Bowman Field', pickup_at: '2020-01-01T00:00:00.000Z' },
      // 6. Driver upcoming trip (future, not due now)
      { id: 'trip-upcoming', driver_id: 'driver-1', status: 'accepted', pickup_label: 'Clemson House', pickup_at: '2099-01-01T00:00:00.000Z' },
    ],
  })

  const desk = await loadDriverDesk(supabase, 'driver-1')
  assert.equal(desk.online, true)
  assert.equal(desk.priority, true)
  assert.equal(desk.lat, 34.68)
  assert.equal(desk.lng, -82.84)
  assert.ok(desk.vehicle)
  assert.ok(desk.profile)
  assert.ok(desk.facing)
  assert.equal(desk.warning, null)
  assert.equal(desk.approvalGate, null)

  // Offers should include trip-open and exclude passed / unpaid
  assert.equal(desk.offers.length, 1)
  assert.equal(desk.offers[0].id, 'trip-open')

  // Scheduled open
  assert.equal(desk.scheduledOpen.length, 1)
  assert.equal(desk.scheduledOpen[0].id, 'trip-sched')

  // Active (due now)
  assert.ok(desk.active)
  assert.equal(desk.active.id, 'trip-active')

  // Upcoming (future)
  assert.equal(desk.upcoming.length, 1)
  assert.equal(desk.upcoming[0].id, 'trip-upcoming')
})

test('loadDriverDesk hides open-pool offers for pending_review and keeps the live trip', async () => {
  const supabase = createFakeSupabase({
    driver_applications: [
      { profile_id: 'driver-1', onboarding_status: 'pending_review' },
    ],
    driver_status: [
      { driver_id: 'driver-1', online: true },
    ],
    trips: [
      { id: 'trip-open', status: 'searching', pickup_label: 'Tillman Hall' },
      { id: 'trip-sched', status: 'scheduled', driver_id: null, pickup_at: '2099-01-01T00:00:00.000Z' },
      { id: 'trip-live', driver_id: 'driver-1', status: 'in_progress', pickup_label: 'Bowman Field' },
    ],
  })

  const desk = await loadDriverDesk(supabase, 'driver-1')
  assert.deepEqual(desk.offers, [])
  assert.deepEqual(desk.scheduledOpen, [])
  assert.equal(desk.approvalGate, approvalGateMessage())
  assert.equal(desk.active?.id, 'trip-live')
})

test('loadDriverDesk surfaces warning when trip query encounters error', async () => {
  const supabase = createFakeSupabase(
    {
      driver_status: [{ driver_id: 'driver-1', online: true }],
    },
    {
      onError(table) {
        if (table === 'trips') {
          return { message: 'Simulated trips query failure' }
        }
        return null
      },
    },
  )

  const desk = await loadDriverDesk(supabase, 'driver-1')
  assert.ok(desk.warning)
  assert.match(desk.warning, /Simulated trips query failure/)
})

// ---------------------------------------------------------------------------
// 18. loadEarnings
// ---------------------------------------------------------------------------
test('loadEarnings returns empty summary when client or driverId is missing', async () => {
  const supabase = createFakeSupabase()
  const res = await loadEarnings(null, 'driver-1')
  assert.deepEqual(res.trips, [])
  assert.equal(res.apiError, null)
  assert.equal(res.payoutError, null)
  assert.ok(res.summary)
})

test('loadEarnings queries trips and combines API earnings and payouts', async () => {
  const supabase = createFakeSupabase({
    trips: [
      {
        id: 'trip-earn-1',
        driver_id: 'driver-1',
        status: 'completed',
        fare_cents: 3000,
        completed_at: '2026-09-24T10:00:00.000Z',
      },
    ],
  })

  await withMockFetch(
    {
      '/api/driver?action=earnings': {
        status: 200,
        body: {
          paymentsByTrip: {
            'trip-earn-1': [{ kind: 'fare', amountCents: 2400, status: 'succeeded' }],
          },
        },
      },
      '/api/driver?action=payouts': {
        status: 200,
        body: { paidCents: 5000, pendingCents: 2400 },
      },
    },
    async () => {
      const earnings = await loadEarnings(supabase, 'driver-1')
      assert.equal(earnings.trips.length, 1)
      assert.equal(earnings.trips[0].id, 'trip-earn-1')
      assert.ok(earnings.paymentsByTrip['trip-earn-1'])
      assert.equal(earnings.payouts.paidCents, 5000)
      assert.equal(earnings.apiError, null)
      assert.equal(earnings.payoutError, null)
    },
  )
})

test('loadEarnings captures API errors while still returning trip history', async () => {
  const supabase = createFakeSupabase({
    trips: [
      {
        id: 'trip-earn-2',
        driver_id: 'driver-1',
        status: 'completed',
        fare_cents: 2000,
      },
    ],
  })

  await withMockFetch(
    {
      '/api/driver?action=earnings': { status: 500, body: { error: 'Earnings service down' } },
      '/api/driver?action=payouts': { status: 503, body: { error: 'Payouts service unavailable' } },
    },
    async () => {
      const earnings = await loadEarnings(supabase, 'driver-1')
      assert.equal(earnings.trips.length, 1)
      // #90 friendlyApiError: a 500 body no longer reaches the UI verbatim
      assert.equal(earnings.apiError, 'Something went wrong. Please try again.')
      assert.equal(earnings.payoutError, 'Payments are temporarily unavailable, please try again shortly')
    },
  )
})

test('loadEarnings retries without deposit_cents on schema cache error', async () => {
  const supabase = createFakeSupabase(
    {
      trips: [
        {
          id: 'trip-earn-3',
          driver_id: 'driver-1',
          status: 'completed',
          fare_cents: 3500,
        },
      ],
    },
    {
      onError(table, state) {
        if (table === 'trips' && state.columns.includes('deposit_cents')) {
          return { message: 'column deposit_cents does not exist in schema cache' }
        }
        return null
      },
    },
  )

  await withMockFetch({}, async () => {
    const earnings = await loadEarnings(supabase, 'driver-1')
    assert.equal(earnings.trips.length, 1)
    assert.equal(earnings.trips[0].id, 'trip-earn-3')
  })
})
