const DEFAULT_PICKUP = { lat: 34.6834, lng: -82.8374 }
const DEFAULT_DROPOFF = { lat: 34.8957, lng: -82.2189 }

function cloneRows(initialTables) {
  return Object.fromEntries(
    Object.entries(initialTables).map(([name, rows]) => [
      name,
      rows.map((row) => structuredClone(row)),
    ]),
  )
}

function matches(row, filter) {
  const value = row[filter.column]
  switch (filter.kind) {
    case 'eq': return filter.column === 'metadata' ? JSON.stringify(value) === filter.value : value === filter.value
    case 'or': {
      const target = row.metadata?.offer_driver_id
      return target == null || target === '' || target === JSON.parse(filter.value.split('metadata->>offer_driver_id.eq.').at(-1))
    }
    case 'in': return filter.value.includes(value)
    case 'is': return filter.value === null ? value == null : value === filter.value
    case 'not': return filter.operator === 'is' && filter.value === null ? value != null : value !== filter.value
    case 'lte': return value != null && value <= filter.value
    case 'gte': return value != null && value >= filter.value
    default: return true
  }
}

/**
 * Deterministic, credential-free Supabase double for the matching seam.
 * It intentionally implements only the query operations used by driverDesk.
 */
export function createMatchingSupabase(initialTables = {}) {
  const tables = cloneRows(initialTables)

  function run(state) {
    if (!tables[state.table]) {
      if (state.mode === 'select') return { data: [], error: null }
      tables[state.table] = []
    }
    const source = tables[state.table]
    const selected = () => {
      let rows = source.filter((row) => state.filters.every((filter) => matches(row, filter)))
      for (const order of [...state.orders].reverse()) {
        rows = [...rows].sort((left, right) => {
          const a = left[order.column]
          const b = right[order.column]
          if (a === b) return 0
          if (a == null) return order.ascending ? 1 : -1
          if (b == null) return order.ascending ? -1 : 1
          return (a < b ? -1 : 1) * (order.ascending ? 1 : -1)
        })
      }
      if (state.limit != null) rows = rows.slice(0, state.limit)
      return rows
    }

    if (state.mode === 'select') return { data: selected().map((row) => structuredClone(row)), error: null }
    if (state.mode === 'update') {
      const rows = selected()
      rows.forEach((row) => Object.assign(row, structuredClone(state.payload)))
      return { data: rows.map((row) => structuredClone(row)), error: null }
    }
    if (state.mode === 'insert') {
      const payloads = Array.isArray(state.payload) ? state.payload : [state.payload]
      const inserted = payloads.map((payload, index) => ({
        id: payload.id || `${state.table}-${source.length + index + 1}`,
        ...structuredClone(payload),
      }))
      source.push(...inserted)
      return { data: inserted.map((row) => structuredClone(row)), error: null }
    }
    if (state.mode === 'upsert') {
      const payloads = Array.isArray(state.payload) ? state.payload : [state.payload]
      const result = payloads.map((payload) => {
        let key
        if (state.table === 'driver_status') {
          key = (row) => row.driver_id === payload.driver_id
        } else if (state.table === 'driver_offer_passes') {
          key = (row) => row.driver_id === payload.driver_id && row.trip_id === payload.trip_id
        } else {
          key = (row) => row.id === payload.id
        }
        const existing = source.find(key)
        if (existing) {
          Object.assign(existing, structuredClone(payload))
          return existing
        }
        const inserted = structuredClone(payload)
        source.push(inserted)
        return inserted
      })
      return { data: result.map((row) => structuredClone(row)), error: null }
    }
    throw new Error(`Unsupported fixture operation: ${state.mode}`)
  }

  function query(table) {
    const state = { table, mode: 'select', filters: [], orders: [], limit: null, payload: null }
    const builder = {
      select() { return builder },
      or(value) { state.filters.push({ kind: 'or', value }); return builder },
      eq(column, value) { state.filters.push({ kind: 'eq', column, value }); return builder },
      in(column, value) { state.filters.push({ kind: 'in', column, value }); return builder },
      is(column, value) { state.filters.push({ kind: 'is', column, value }); return builder },
      not(column, operator, value) { state.filters.push({ kind: 'not', column, operator, value }); return builder },
      lte(column, value) { state.filters.push({ kind: 'lte', column, value }); return builder },
      gte(column, value) { state.filters.push({ kind: 'gte', column, value }); return builder },
      order(column, { ascending = true } = {}) { state.orders.push({ column, ascending }); return builder },
      limit(value) { state.limit = value; return builder },
      update(payload) { state.mode = 'update'; state.payload = payload; return builder },
      insert(payload) { state.mode = 'insert'; state.payload = payload; return builder },
      upsert(payload) { state.mode = 'upsert'; state.payload = payload; return builder },
      async maybeSingle() {
        const result = run(state)
        return { data: result.data[0] || null, error: result.error }
      },
      async single() {
        const result = run(state)
        return result.data.length === 1
          ? { data: result.data[0], error: null }
          : { data: null, error: new Error('Expected exactly one fixture row') }
      },
      then(resolve, reject) {
        try { resolve(run(state)) } catch (error) { reject(error) }
      },
    }
    return builder
  }

  return {
    _tables: tables,
    from: query,
    channel() {
      const channel = { on() { return channel }, subscribe() { return channel } }
      return channel
    },
    removeChannel() {},
  }
}

export function seedMatchingScenario({
  tripId = 'trip-searching-1',
  riderId = 'rider-1',
  drivers = [
    { id: 'driver-1', approved: true, online: true, lat: 34.6801, lng: -82.8412 },
    { id: 'driver-2', approved: true, online: true, lat: 34.6812, lng: -82.8401 },
  ],
  trip = {},
} = {}) {
  const baseTrip = {
    id: tripId,
    rider_id: riderId,
    driver_id: null,
    status: 'searching',
    tier: 'standard',
    pickup_label: 'Memorial Stadium',
    dropoff_label: 'GSP Airport',
    pickup_lat: DEFAULT_PICKUP.lat,
    pickup_lng: DEFAULT_PICKUP.lng,
    dropoff_lat: DEFAULT_DROPOFF.lat,
    dropoff_lng: DEFAULT_DROPOFF.lng,
    requested_at: '2026-10-01T08:00:00.000Z',
    metadata: {},
    ...trip,
  }
  const initialTables = {
    trips: [baseTrip],
    profiles: [
      { id: riderId, full_name: 'Fixture Rider' },
      ...drivers.map((driver) => ({ id: driver.id, full_name: `Fixture ${driver.id}` })),
    ],
    driver_applications: drivers.map((driver) => ({
      profile_id: driver.id,
      onboarding_status: driver.approved ? 'approved' : 'pending_review',
    })),
    driver_status: drivers.map((driver) => ({
      driver_id: driver.id,
      online: driver.online,
      priority_mode: false,
      lat: driver.lat,
      lng: driver.lng,
    })),
    driver_offer_passes: [],
    trip_events: [],
    vehicles: [],
    game_day_events: [],
  }
  return {
    supabase: createMatchingSupabase(initialTables),
    trip: structuredClone(baseTrip),
    riderId,
    drivers: drivers.map((driver) => ({ ...driver })),
  }
}

export function riderTrackingSnapshot(supabase, tripId) {
  const trip = supabase._tables.trips.find((row) => row.id === tripId)
  if (!trip) return null
  const driver = supabase._tables.profiles.find((row) => row.id === trip.driver_id)
  const status = supabase._tables.driver_status.find((row) => row.driver_id === trip.driver_id)
  return {
    ...structuredClone(trip),
    driverName: driver?.full_name || null,
    driverLat: status?.lat ?? null,
    driverLng: status?.lng ?? null,
  }
}

export async function cancelSearchingTrip(supabase, tripId, riderId, at = '2026-10-01T08:05:00.000Z') {
  const { data, error } = await supabase
    .from('trips')
    .update({ status: 'canceled', canceled_at: at })
    .eq('id', tripId)
    .eq('rider_id', riderId)
    .in('status', ['searching', 'offered'])
    .select('id, status, rider_id, driver_id, canceled_at')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('That ride is no longer searching')

  const event = await supabase.from('trip_events').insert({
    trip_id: tripId,
    kind: 'canceled',
    payload: { reason: 'rider_cancel', source: 'rider_app', canceled_at: at },
  })
  if (event.error) throw event.error
  return data
}

export async function expireSearchingTrip(supabase, tripId, {
  expiredBefore,
  at = '2026-10-01T08:15:00.000Z',
} = {}) {
  if (!expiredBefore) throw new Error('An expiry cutoff is required')
  const { data, error } = await supabase
    .from('trips')
    .update({ status: 'canceled', canceled_at: at })
    .eq('id', tripId)
    .in('status', ['searching', 'offered'])
    .lte('requested_at', expiredBefore)
    .select('id, status, rider_id, driver_id, requested_at, canceled_at')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('That ride is not eligible for search expiry')

  const event = await supabase.from('trip_events').insert({
    trip_id: tripId,
    kind: 'canceled',
    payload: { reason: 'search_ttl_expired', source: 'matching_ttl', canceled_at: at },
  })
  if (event.error) throw event.error
  return data
}

export async function requestDriverTrip(supabase, {
  id,
  riderId,
  pickupLabel = 'Memorial Stadium',
  dropoffLabel = 'Downtown Clemson',
  requestedAt = '2026-10-01T08:06:00.000Z',
} = {}) {
  if (!id || !riderId) throw new Error('Trip and rider are required')
  const row = {
    id,
    rider_id: riderId,
    driver_id: null,
    status: 'searching',
    tier: 'standard',
    pickup_label: pickupLabel,
    dropoff_label: dropoffLabel,
    pickup_lat: DEFAULT_PICKUP.lat,
    pickup_lng: DEFAULT_PICKUP.lng,
    dropoff_lat: 34.6857,
    dropoff_lng: -82.8147,
    requested_at: requestedAt,
    metadata: {},
  }
  const { data, error } = await supabase
    .from('trips')
    .insert(row)
    .select('*')
    .single()
  if (error) throw error
  const event = await supabase.from('trip_events').insert({
    trip_id: id,
    kind: 'searching',
    payload: { source: 'rider_app' },
  })
  if (event.error) throw event.error
  return data
}
