import test from 'node:test'
import assert from 'node:assert/strict'
import {
  recordDeposit,
  reconcileCheckoutSession,
} from '../server/checkoutReconcile.js'
import reconcileCheckoutHandler from '../server/endpoints/reconcileCheckout.js'
import abandonCheckoutHandler from '../server/endpoints/abandonCheckout.js'

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    writableEnded: false,
    headersSent: false,
    body: '',
    setHeader(name, value) {
      if (this.headersSent) {
        throw new Error('ERR_HTTP_HEADERS_SENT: Cannot set headers after they are sent')
      }
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      if (this.writableEnded) {
        throw new Error('ERR_STREAM_WRITE_AFTER_END: write after end')
      }
      this.headersSent = true
      this.writableEnded = true
      this.body = payload == null ? '' : String(payload)
    },
  }
}

function createMockDb() {
  const trips = new Map()
  const payments = []
  const rpcCalls = []
  let rpcImpl = null

  function from(table) {
    const filters = []
    let op = 'select'
    let patch = null

    const api = {
      select() { return api },
      eq(col, val) { filters.push({ col, val }); return api },
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

    function exec() {
      if (table === 'payments') {
        if (op === 'insert') {
          const row = { id: `pay_${payments.length + 1}`, ...patch }
          payments.push(row)
          return { data: row, error: null }
        }
        const matches = payments.filter((p) => filters.every((f) => p[f.col] === f.val))
        return { data: matches, error: null }
      }
      if (table === 'trips') {
        const rows = [...trips.values()].filter((t) => filters.every((f) => t[f.col] === f.val))
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
    rpcCalls.push({ fn, args })
    if (typeof rpcImpl === 'function') {
      return Promise.resolve(rpcImpl(fn, args))
    }
    if (fn === 'merge_trip_metadata') {
      const trip = trips.get(args?.p_trip_id)
      if (trip) {
        trip.metadata = { ...(trip.metadata || {}), ...(args?.p_patch || {}) }
        return Promise.resolve({ data: { id: trip.id, metadata: trip.metadata }, error: null })
      }
    }
    return Promise.resolve({ data: null, error: null })
  }

  return {
    from,
    rpc,
    trips,
    payments,
    rpcCalls,
    setRpcImpl(fn) { rpcImpl = fn },
    seedTrip(t) {
      trips.set(t.id, {
        id: t.id,
        rider_id: t.rider_id || 'rider_1',
        status: t.status || 'searching',
        metadata: t.metadata || {},
        ...t,
      })
    },
  }
}

test('GA95: recordDeposit uses merge_trip_metadata RPC atomically when available', async () => {
  const db = createMockDb()
  db.seedTrip({
    id: 'trip_rpc_test',
    rider_id: 'rider_1',
    metadata: { fare_paid_cents: 0, preexisting_field: 'safe_value' },
  })

  const session = {
    id: 'cs_test_rpc_1',
    amount_total: 2500,
    payment_intent: 'pi_test_rpc_1',
    metadata: { tripId: 'trip_rpc_test', riderId: 'rider_1' },
  }

  const res = await recordDeposit(db, session)
  assert.equal(res.ok, true)

  // Verify RPC was invoked with merge_trip_metadata
  const rpcCall = db.rpcCalls.find((c) => c.fn === 'merge_trip_metadata')
  assert.ok(rpcCall, 'expected merge_trip_metadata RPC to be called')
  assert.equal(rpcCall.args.p_trip_id, 'trip_rpc_test')
  assert.equal(rpcCall.args.p_patch.fare_paid_cents, 2500)
  assert.equal(rpcCall.args.p_patch.checkout_deposit.session_id, 'cs_test_rpc_1')

  const updatedTrip = db.trips.get('trip_rpc_test')
  assert.equal(updatedTrip.metadata.preexisting_field, 'safe_value')
  assert.equal(updatedTrip.metadata.fare_paid_cents, 2500)
})

test('GA95: recordDeposit falls back to direct update when merge_trip_metadata fails or is unavailable', async () => {
  const db = createMockDb()
  db.seedTrip({
    id: 'trip_fallback_test',
    rider_id: 'rider_1',
    metadata: { fare_paid_cents: 0 },
  })

  // Force RPC to return error
  db.setRpcImpl(() => ({ data: null, error: { message: 'function public.merge_trip_metadata does not exist' } }))

  const session = {
    id: 'cs_test_fallback_1',
    amount_total: 3500,
    payment_intent: 'pi_test_fb_1',
    metadata: { tripId: 'trip_fallback_test', riderId: 'rider_1' },
  }

  const res = await recordDeposit(db, session)
  assert.equal(res.ok, true)

  const updatedTrip = db.trips.get('trip_fallback_test')
  assert.equal(updatedTrip.metadata.fare_paid_cents, 3500)
  assert.equal(updatedTrip.metadata.checkout_deposit.session_id, 'cs_test_fallback_1')
})

test('GA95: reconcileCheckoutSession sanitizes and trims whitespace from sessionId', async () => {
  const db = createMockDb()
  db.seedTrip({
    id: 'trip_trim_test',
    rider_id: 'rider_1',
    status: 'searching',
    metadata: {},
  })

  let retrievedId = null
  const stripe = {
    checkout: {
      sessions: {
        retrieve: async (id) => {
          retrievedId = id
          return {
            id,
            status: 'complete',
            payment_status: 'paid',
            amount_total: 2500,
            metadata: { tripId: 'trip_trim_test', riderId: 'rider_1' },
          }
        },
      },
    },
  }

  const res = await reconcileCheckoutSession({
    stripe,
    sb: db,
    sessionId: '   \n\tcs_test_whitespace_ok\r\n  ',
    userId: 'rider_1',
  })

  assert.equal(res.ok, true)
  assert.equal(res.paid, true)
  assert.equal(retrievedId, 'cs_test_whitespace_ok')
})

test('GA95: reconcileCheckout and abandonCheckout endpoints enforce Cache-Control, Pragma, and Allow: POST, OPTIONS', async () => {
  // Reconcile non-POST
  const resRec = mockRes()
  await reconcileCheckoutHandler({ method: 'GET' }, resRec)
  assert.equal(resRec.statusCode, 405)
  assert.equal(resRec.headers['allow'], 'POST, OPTIONS')
  assert.equal(resRec.headers['cache-control'], 'no-store, no-cache, must-revalidate, private')
  assert.equal(resRec.headers['pragma'], 'no-cache')

  // Abandon non-POST
  const resAb = mockRes()
  await abandonCheckoutHandler({ method: 'PUT' }, resAb)
  assert.equal(resAb.statusCode, 405)
  assert.equal(resAb.headers['allow'], 'POST, OPTIONS')
  assert.equal(resAb.headers['cache-control'], 'no-store, no-cache, must-revalidate, private')
  assert.equal(resAb.headers['pragma'], 'no-cache')
})

test('GA95: abandonCheckout endpoint trims tripId/sessionId and releases unpaid hold', async () => {
  const db = createMockDb()
  db.seedTrip({
    id: 'trip_abandon_ga95',
    rider_id: 'rider_1',
    status: 'searching',
    metadata: { stripe_checkout_session_id: 'cs_abandon_ga95' },
  })

  let expiredId = null
  const stripe = {
    checkout: {
      sessions: {
        retrieve: async (id) => ({
          id,
          status: 'open',
          payment_status: 'unpaid',
          metadata: { tripId: 'trip_abandon_ga95', riderId: 'rider_1' },
        }),
        expire: async (id) => {
          expiredId = id
          return { id, status: 'expired' }
        },
      },
    },
  }

  const req = {
    method: 'POST',
    body: {
      tripId: '   trip_abandon_ga95   \n',
      sessionId: '   cs_abandon_ga95   ',
    },
  }
  const res = mockRes()

  await abandonCheckoutHandler(req, res, {
    sb: db,
    user: { id: 'rider_1' },
    stripe,
    releaseUnpaidCheckoutTrip: async (sb, session, opts) => {
      if (opts.expireSession) await opts.expireSession(session.id)
      return { released: true, status: 'canceled', tripId: 'trip_abandon_ga95' }
    },
  })

  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.released, true)
  assert.equal(expiredId, 'cs_abandon_ga95')
})
