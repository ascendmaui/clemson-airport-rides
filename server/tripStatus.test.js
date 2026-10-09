import test from 'node:test'
import assert from 'node:assert/strict'
import handleTripStatus from './endpoints/tripStatus.js'
import driverHandler from '../api/driver.js'

function fakeSb(trip, options = {}) {
  const tables = {
    trips: [{ ...trip }], trip_events: [], payments: [], profiles: [],
    driver_applications: [{ profile_id: 'd1', onboarding_status: options.approval || 'approved' }],
    driver_status: [{ driver_id: 'd1', online: options.online ?? true }],
  }
  const mutations = []
  const sb = {
    tables, mutations,
    rpc: async () => options.pairError ? { error: options.pairError } : { data: options.pair ?? true },
    from(table) {
      const filters = []
      let mode = 'read', patch
      const run = () => {
        if (mode === 'insert') {
          tables[table].push(patch)
          return { data: patch, error: null }
        }
        if (mode === 'update') {
          mutations.push({ table, patch, filters })
          if (options.updateError) return { data: null, error: options.updateError }
          options.beforeUpdate?.(tables[table][0])
          if (options.race) return { data: null, error: null }
        }
        const matches = tables[table].filter(row => filters.every(([type, key, value]) => {
          if (type === 'in') return value.includes(row[key])
          if (key === 'metadata' && type === 'eq') return JSON.stringify(row[key]) === value
          if (type === 'is' && value === null) return row[key] == null
          return row[key] === value
        }))
        if (mode === 'update') matches.forEach(row => Object.assign(row, patch))
        return { data: matches, error: null }
      }
      const query = {
        select() { return query },
        eq(key, value) { filters.push(['eq', key, value]); return query },
        is(key, value) { filters.push(['is', key, value]); return query },
        in(key, value) { filters.push(['in', key, value]); return query },
        update(value) { mode = 'update'; patch = value; return query },
        insert(value) { mode = 'insert'; patch = value; return query },
        async maybeSingle() { const result = run(); return { ...result, data: result.data?.[0] || null } },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
      }
      return query
    },
  }
  return sb
}

const base = { id: 't1', rider_id: 'r1', driver_id: 'd1', status: 'accepted', fare_cents: 1000, metadata: {} }
async function request(sb, op, { user = { id: 'd1' }, method = 'POST', body, handler = handleTripStatus, ...deps } = {}) {
  let result
  const res = { setHeader() {}, end(value) { result = { http: this.statusCode, body: JSON.parse(value) } } }
  await handler({ method, url: '/api/driver?action=trip-status', headers: {}, body: body ?? { tripId: 't1', op } }, res, { sb, user, ...deps })
  return result
}

test('wrong driver and rider receive 403 before any driver action or idempotency', async () => {
  for (const userId of ['other-driver', 'r1']) {
    for (const op of ['arriving', 'arrive', 'start', 'complete', 'cancel']) {
      const sb = fakeSb(base)
      const result = await request(sb, op, { user: { id: userId } })
      assert.equal(result.http, 403)
      assert.equal(sb.mutations.length, 0)
    }
  }
  assert.equal((await request(fakeSb(base), 'accept', { user: { id: 'r1' } })).http, 403)
})

test('same-status requests are authorized idempotent successes for every operation', async () => {
  for (const [op, status] of Object.entries({ accept: 'accepted', arriving: 'arriving', arrive: 'arrived', start: 'in_progress', complete: 'completed', cancel: 'cancelled_wait' })) {
    const sb = fakeSb({ ...base, status })
    const result = await request(sb, op)
    assert.equal(result.http, 200, op)
    assert.equal(result.body.idempotent, true)
    assert.equal(result.body.trip.status, status)
    assert.equal(sb.mutations.length, 0)
    assert.equal(sb.tables.trip_events.length, 0)
  }
})

test('accept conditional race and dispatch retarget both return 409 without an event', async () => {
  for (const options of [{ race: true }, { beforeUpdate(row) { row.metadata = { offer_driver_id: 'other-driver' } } }]) {
    const sb = fakeSb({ ...base, status: 'searching', driver_id: null }, options)
    const result = await request(sb, 'accept')
    assert.equal(result.http, 409)
    const filters = sb.mutations[0].filters
    assert.ok(filters.some(([type, key, value]) => type === 'is' && key === 'driver_id' && value === null))
    assert.ok(filters.some(([type, key, value]) => type === 'in' && key === 'status' && value.join(',') === 'searching,offered'))
    assert.equal(sb.tables.trip_events.length, 0)
  }
})

test('accept locks stored offer economics and preserves other metadata, logging once', async () => {
  for (const [phase, bps] of [['exclusive', 8000], ['pool', 7000]]) {
    const sb = fakeSb({ ...base, driver_id: null, status: 'offered', metadata: { offer_phase: phase, offer_share_bps: bps, other_key: 'kept' } })
    const result = await request(sb, 'accept', { body: { tripId: 't1', op: 'accept', driver_id: 'other-driver', driver_payout_cents: 99999 } })
    assert.equal(result.http, 200)
    const trip = result.body.trip
    assert.equal(trip.driver_id, 'd1')
    assert.equal(trip.driver_earnings_cents, bps / 10)
    assert.equal(trip.platform_fee_cents, 1000 - bps / 10)
    assert.equal(trip.metadata.driver_payout_cents, bps / 10)
    assert.equal(trip.metadata.other_key, 'kept')
    assert.equal(sb.tables.trip_events.length, 1)
  }
})

test('accept validates approval, online presence, pair, deposit, targeting and scheduling', async () => {
  const open = { ...base, status: 'searching', driver_id: null }
  for (const [trip, options, http, code] of [
    [open, { approval: 'pending_review' }, 403, 'driver_not_approved'],
    [open, { online: false }, 409, 'driver_offline'],
    [open, { pair: false }, 403, 'pair_not_allowed'],
    [{ ...open, deposit_cents: 2500, metadata: { purpose: 'airport' } }, {}, 409, 'airport_deposit_unpaid'],
    [{ ...open, metadata: { offer_driver_id: 'd2' } }, {}, 409, 'offer_unavailable'],
    [{ ...open, metadata: { offer_passed_driver_ids: ['d1'] } }, {}, 409, 'offer_unavailable'],
    [{ ...open, scheduled_for: '2026-10-10T12:00:00Z' }, {}, 409, 'scheduled_rpc_required'],
  ]) {
    const sb = fakeSb(trip, options)
    const result = await request(sb, 'accept')
    assert.equal(result.http, http)
    assert.equal(result.body.code, code)
    assert.equal(sb.mutations.length, 0)
  }
  assert.equal((await request(fakeSb(open, { pairError: { code: 'PGRST202' } }), 'accept')).http, 200)
  assert.equal((await request(fakeSb(open, { pairError: { code: 'XX000', message: 'RPC unavailable' } }), 'accept')).http, 500)
})

test('arriving conditionally progresses and writes exactly one event', async () => {
  const sb = fakeSb(base)
  assert.equal((await request(sb, 'arriving')).body.trip.status, 'arriving')
  assert.ok(sb.mutations[0].filters.some(([type, key, value]) => type === 'eq' && key === 'status' && value === 'accepted'))
  assert.equal((await request(sb, 'arriving')).body.idempotent, true)
  assert.equal(sb.tables.trip_events.length, 1)
})

test('wait actions delegate once and start surfaces cancellation and charging', async () => {
  for (const [op, status] of [['arrive', 'accepted'], ['start', 'arrived'], ['cancel', 'arrived']]) {
    const sb = fakeSb({ ...base, status })
    let calls = 0
    const result = await request(sb, op, { applyTripWait: async (client, args) => {
      calls++
      assert.equal(client, sb)
      assert.deepEqual(args, { action: op, tripId: 't1', actorId: 'd1' })
      return { trip: { ...base, status: op === 'arrive' ? 'arrived' : 'cancelled_wait' }, should_charge: op !== 'arrive', charge: { status: 'pending' } }
    } })
    assert.equal(result.http, 200)
    assert.equal(calls, 1)
    assert.equal(sb.tables.trip_events.length, 0)
    if (op === 'start') {
      assert.equal(result.body.trip.status, 'cancelled_wait')
      assert.equal(result.body.wait.should_charge, true)
    }
  }
})

test('wait timer errors are 409 and legacy cancel is still limited to the wait path', async () => {
  const timer = await request(fakeSb({ ...base, status: 'arrived' }), 'cancel', { applyTripWait: async () => { throw Object.assign(new Error('Cancel ride opens after 5 minutes of waiting'), { status: 409 }) } })
  assert.equal(timer.http, 409)
  for (const status of ['accepted', 'arriving']) {
    const result = await request(fakeSb({ ...base, status }), 'cancel')
    assert.equal(result.http, 409)
    assert.equal(result.body.code, 'invalid_transition')
    assert.match(result.body.hint, /driver-cancel/)
  }
})

test('complete delegates settlement, preserves payment failures and returns the saved trip', async () => {
  for (const http of [200, 402]) {
    const sb = fakeSb({ ...base, status: 'in_progress' })
    const result = await request(sb, 'complete', { stripeClient: () => null, settleTrip: async (args) => {
      assert.equal(args.action, 'complete')
      assert.deepEqual(args.actor, { id: 'd1' })
      if (http === 200) sb.tables.trips[0] = { ...base, status: 'completed', completed_at: '2026-10-09T12:00:00Z' }
      return { http, body: http === 200 ? { ok: true, status: 'completed', payout: { status: 'pending' } } : { code: 'payment_required', failure: { message: 'Payment required' } } }
    } })
    assert.equal(result.http, http)
    if (http === 200) {
      assert.equal(result.body.trip.status, 'completed')
      assert.equal(result.body.settle.payout.status, 'pending')
    } else assert.equal(result.body.failure.message, 'Payment required')
    assert.equal(sb.tables.trip_events.length, 0)
  }
})

test('endpoint rejects missing auth, missing trips, invalid operations and invalid bodies', async () => {
  assert.equal((await request(fakeSb(base), 'arriving', { user: null })).http, 401)
  assert.equal((await request(fakeSb(base), 'arriving', { method: 'GET' })).http, 405)
  assert.equal((await request(fakeSb(base), 'other')).http, 400)
  assert.equal((await request(fakeSb(base), 'arriving', { body: '{}' })).http, 400)
  const sb = fakeSb(base)
  sb.tables.trips = []
  assert.equal((await request(sb, 'arriving')).http, 404)
})

test('driver router dispatches trip-status with the original operation body', async () => {
  const result = await request(fakeSb(base), 'arriving', { handler: driverHandler })
  assert.equal(result.http, 200)
  assert.equal(result.body.trip.status, 'arriving')
})

test('database eligibility races return useful 4xx failures', async () => {
  for (const [message, status] of [['This ride offer changed. Refresh and try again.', 409], ['Go online before accepting a ride.', 409], ['Finish approval to go online. Your account is still under review.', 403]]) {
    const sb = fakeSb({ ...base, status: 'searching', driver_id: null }, { updateError: { message } })
    const result = await request(sb, 'accept')
    assert.equal(result.http, status)
    assert.equal(result.body.error, message)
  }
})
