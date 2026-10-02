import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decideUnpaidAirportHoldTtl,
  rememberCheckoutSession,
  restoreLiveTripAfterDeposit,
} from '../server/abandonedCheckout.js'

function createMockDb() {
  const trips = new Map()
  const events = []
  const payments = []
  let rpcImpl = null

  function from(table) {
    const filters = []
    let op = 'select'
    let patch = null

    const api = {
      select() { return api },
      eq(col, val) { filters.push({ type: 'eq', col, val }); return api },
      in(col, vals) { filters.push({ type: 'in', col, vals }); return api },
      is(col, val) { filters.push({ type: 'is', col, val }); return api },
      maybeSingle() {
        return Promise.resolve(exec()).then((r) => ({
          data: Array.isArray(r.data) ? (r.data[0] || null) : r.data,
          error: r.error,
        }))
      },
      update(p) { op = 'update'; patch = p; return api },
      insert(p) { op = 'insert'; patch = p; return api },
      then(res, rej) { return Promise.resolve(exec()).then(res, rej) },
    }

    function matchRow(row) {
      return filters.every((f) => {
        if (f.type === 'eq') return row[f.col] === f.val
        if (f.type === 'in') return Array.isArray(f.vals) && f.vals.includes(row[f.col])
        if (f.type === 'is') return f.val == null ? row[f.col] == null : row[f.col] === f.val
        return false
      })
    }

    function exec() {
      if (table === 'trip_events') {
        if (op === 'insert') {
          events.push(patch)
          return { data: patch, error: null }
        }
        return { data: events, error: null }
      }
      if (table === 'payments') {
        const matches = payments.filter(matchRow)
        return { data: matches, error: null }
      }
      if (table === 'trips') {
        const rows = [...trips.values()].filter(matchRow)
        if (op === 'update') {
          const updated = rows.map((r) => {
            const next = { ...r, ...patch }
            trips.set(next.id, next)
            return next
          })
          return { data: updated, error: null }
        }
        return { data: rows, error: null }
      }
      return { data: null, error: null }
    }

    return api
  }

  function rpc(fn, args) {
    if (typeof rpcImpl === 'function') {
      return Promise.resolve(rpcImpl(fn, args))
    }
    if (fn === 'merge_trip_metadata') {
      const trip = trips.get(args?.p_trip_id)
      if (trip) {
        trip.metadata = { ...(trip.metadata || {}), ...(args?.p_patch || {}) }
        if (args?.p_new_status) trip.status = args.p_new_status
        if (args?.p_canceled_at) trip.canceled_at = args.p_canceled_at
        return Promise.resolve({ data: { id: trip.id, status: trip.status, metadata: trip.metadata }, error: null })
      }
    }
    return Promise.resolve({ data: null, error: null })
  }

  return {
    from,
    rpc,
    trips,
    events,
    payments,
    setRpcImpl(fn) { rpcImpl = fn },
    seedTrip(t) {
      trips.set(t.id, {
        id: t.id,
        rider_id: t.rider_id || 'rider_1',
        driver_id: t.driver_id || null,
        status: t.status || 'searching',
        metadata: t.metadata || {},
        created_at: t.created_at || new Date().toISOString(),
        deposit_cents: t.deposit_cents ?? 2500,
        ...t,
      })
    },
  }
}

test('GA96: decideUnpaidAirportHoldTtl handles NaN, null, and non-numeric now and ttlMs safely', () => {
  const trip = {
    id: 'trip_nan_test',
    status: 'searching',
    deposit_cents: 2500,
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes old
    metadata: { kind: 'airport' },
  }

  // With now = NaN, it should fall back to Date.now() and keep the 5-minute-old hold (within 20-min TTL)
  const resNan = decideUnpaidAirportHoldTtl({ trip, payments: [], now: NaN })
  assert.equal(resNan.action, 'skip')
  assert.equal(resNan.reason, 'within_ttl')

  // With now = 'invalid', fallback to Date.now()
  const resInvalid = decideUnpaidAirportHoldTtl({ trip, payments: [], now: 'not_a_date' })
  assert.equal(resInvalid.action, 'skip')
  assert.equal(resInvalid.reason, 'within_ttl')

  // With ttlMs = -1 or invalid, fallback to default 20-minute TTL (5 min old -> within_ttl)
  const resBadTtl = decideUnpaidAirportHoldTtl({ trip, payments: [], ttlMs: -1000 })
  assert.equal(resBadTtl.action, 'skip')
  assert.equal(resBadTtl.reason, 'within_ttl')

  // An old trip (30 minutes old) with now = NaN expires correctly
  const oldTrip = {
    ...trip,
    created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  }
  const resOld = decideUnpaidAirportHoldTtl({ trip: oldTrip, payments: [], now: NaN })
  assert.equal(resOld.action, 'cancel')
  assert.equal(resOld.reason, 'unpaid_hold_ttl')
})

test('GA96: rememberCheckoutSession uses merge_trip_metadata RPC when available', async () => {
  const db = createMockDb()
  db.seedTrip({ id: 'trip_bind_1', metadata: { existing: 'val' } })

  const res = await rememberCheckoutSession(db, 'trip_bind_1', 'cs_bind_1')
  assert.equal(res.ok, true)

  const trip = db.trips.get('trip_bind_1')
  assert.equal(trip.metadata.stripe_checkout_session_id, 'cs_bind_1')
  assert.equal(trip.metadata.existing, 'val')
  assert.ok(trip.metadata.stripe_checkout_created_at)
})

test('GA96: rememberCheckoutSession falls back to direct table update if merge_trip_metadata fails or is unavailable', async () => {
  const db = createMockDb()
  db.seedTrip({ id: 'trip_bind_fb', metadata: { existing: 'val' } })

  // Force RPC failure
  db.setRpcImpl(() => ({ data: null, error: { message: 'RPC merge_trip_metadata failed' } }))

  const res = await rememberCheckoutSession(db, 'trip_bind_fb', 'cs_bind_fb')
  assert.equal(res.ok, true)

  const trip = db.trips.get('trip_bind_fb')
  assert.equal(trip.metadata.stripe_checkout_session_id, 'cs_bind_fb')
  assert.equal(trip.metadata.existing, 'val')
  assert.ok(trip.metadata.stripe_checkout_created_at)
})

test('GA96: restoreLiveTripAfterDeposit handles already_live trip stamp fallback when RPC fails', async () => {
  const db = createMockDb()
  db.seedTrip({
    id: 'trip_live_stamp',
    status: 'searching',
    metadata: { kind: 'airport_deposit' },
  })

  // Force RPC failure on already_live metadata stamp
  db.setRpcImpl(() => ({ data: null, error: { message: 'RPC not available' } }))

  const session = {
    id: 'cs_live_stamp',
    status: 'complete',
    payment_status: 'paid',
    metadata: { tripId: 'trip_live_stamp', kind: 'airport_deposit' },
  }

  const res = await restoreLiveTripAfterDeposit(db, session)
  assert.equal(res.restored, false)
  assert.equal(res.reason, 'already_live')

  const trip = db.trips.get('trip_live_stamp')
  assert.equal(trip.metadata.checkout_deposit.session_id, 'cs_live_stamp')
})

test('GA96: restoreLiveTripAfterDeposit handles missing session id safely', async () => {
  const db = createMockDb()
  db.seedTrip({
    id: 'trip_restore_null_id',
    status: 'canceled',
    metadata: { checkout_abandoned: { reason: 'test' } },
  })

  const session = {
    id: null,
    status: 'complete',
    payment_status: 'paid',
    metadata: { tripId: 'trip_restore_null_id' },
  }

  const res = await restoreLiveTripAfterDeposit(db, session)
  assert.equal(res.restored, true)
  assert.equal(res.status, 'searching')
})
