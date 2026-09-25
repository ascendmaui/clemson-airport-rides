import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  cancelUnopenedCheckoutTrip,
  decideUnpaidAirportHoldTtl,
  releaseExpiredUnpaidAirportHold,
  releaseExpiredUnpaidAirportHolds,
  releaseFromCheckoutEvent,
  releaseUnpaidCheckoutTrip,
  rememberCheckoutSession,
  restoreLiveTripAfterDeposit,
  UNPAID_AIRPORT_HOLD_TTL_MS,
} from './abandonedCheckout.js'
import expireUnpaidAirportHolds, { holdTtlCronAuthorized } from './endpoints/expireUnpaidAirportHolds.js'

function readColumn(row, col) {
  const spec = String(col || '')
  if (!spec.includes('->')) return row?.[spec]
  let cur = row
  for (const part of spec.split('->')) {
    if (cur == null || typeof cur !== 'object') return null
    const text = part.startsWith('>')
    const key = text ? part.slice(1) : part
    if (!key) return null
    cur = cur[key]
    if (cur === undefined || cur === null) return null
    if (text && typeof cur !== 'string') cur = String(cur)
  }
  return cur
}

function memoryDb() {
  const trips = new Map()
  const payments = []
  const events = []

  function compareFilter(rowVal, filterVal, op) {
    if (rowVal == null) return false
    if (typeof filterVal === 'number') {
      const n = Number(rowVal)
      if (!Number.isFinite(n)) return false
      if (op === 'gt') return n > filterVal
      if (op === 'lt') return n < filterVal
      if (op === 'lte') return n <= filterVal
      return false
    }
    const left = String(rowVal)
    const right = String(filterVal)
    if (op === 'gt') return left > right
    if (op === 'lt') return left < right
    if (op === 'lte') return left <= right
    return false
  }

  function match(row, filters) {
    return filters.every((filter) => {
      if (filter.type === 'eq') return readColumn(row, filter.col) === filter.val
      if (filter.type === 'in') return filter.vals.includes(row[filter.col])
      if (filter.type === 'is') {
        const current = readColumn(row, filter.col)
        return filter.val == null ? current == null : current === filter.val
      }
      if (filter.type === 'gt' || filter.type === 'lt' || filter.type === 'lte') {
        return compareFilter(row[filter.col], filter.val, filter.type)
      }
      return false
    })
  }

  function query(table) {
    const state = { table, filters: [], op: 'select', patch: null, order: null, limit: null }
    const exec = () => {
      if (state.table === 'trip_events' && state.op === 'insert') {
        events.push(state.patch)
        return { data: state.patch, error: null }
      }
      if (state.table === 'payments') {
        return { data: payments.filter((row) => match(row, state.filters)), error: null }
      }
      if (state.table !== 'trips') return { data: null, error: { message: `unknown table ${state.table}` } }
      let rows = [...trips.values()].filter((row) => match(row, state.filters))
      if (state.op === 'update') {
        const updated = rows.map((row) => {
          const next = { ...row, ...state.patch }
          trips.set(next.id, next)
          return next
        })
        return { data: updated, error: null }
      }
      if (state.order) {
        const { col, ascending } = state.order
        rows.sort((a, b) => {
          const av = a[col]
          const bv = b[col]
          if (av === bv) return 0
          if (av == null) return 1
          if (bv == null) return -1
          const cmp = av < bv ? -1 : 1
          return ascending ? cmp : -cmp
        })
      }
      if (state.limit != null) rows = rows.slice(0, state.limit)
      return { data: rows, error: null }
    }
    const api = {
      select() { return api },
      eq(col, val) { state.filters.push({ type: 'eq', col, val }); return api },
      in(col, vals) { state.filters.push({ type: 'in', col, vals }); return api },
      is(col, val) { state.filters.push({ type: 'is', col, val }); return api },
      gt(col, val) { state.filters.push({ type: 'gt', col, val }); return api },
      lt(col, val) { state.filters.push({ type: 'lt', col, val }); return api },
      lte(col, val) { state.filters.push({ type: 'lte', col, val }); return api },
      order(col, opts = {}) { state.order = { col, ascending: opts.ascending !== false }; return api },
      limit(n) { state.limit = n; return api },
      update(patch) { state.op = 'update'; state.patch = patch; return api },
      insert(patch) { state.op = 'insert'; state.patch = patch; return api },
      maybeSingle() {
        const result = exec()
        const row = Array.isArray(result.data) ? (result.data[0] || null) : result.data
        return Promise.resolve({ data: row, error: result.error })
      },
      then(resolve, reject) {
        return Promise.resolve(exec()).then(resolve, reject)
      },
    }
    return api
  }

  return {
    trips,
    payments,
    events,
    from(table) { return query(table) },
    seedTrip(row) {
      trips.set(row.id, {
        driver_id: null,
        metadata: {},
        scheduled_for: null,
        canceled_at: null,
        rider_id: 'rider_1',
        ...row,
      })
    },
  }
}

function airportSession(overrides = {}) {
  const metadata = {
    kind: 'airport_deposit',
    tripId: 'trip_1',
    riderId: 'rider_1',
    ...(overrides.metadata || {}),
  }
  return {
    id: 'cs_1',
    status: 'expired',
    payment_status: 'unpaid',
    ...overrides,
    metadata,
  }
}

function expiredEvent(session) {
  return { type: 'checkout.session.expired', data: { object: session } }
}

test('expired unpaid searching checkout cancels the trip once', async () => {
  const db = memoryDb()
  db.seedTrip({ id: 'trip_1', status: 'searching', metadata: { purpose: 'airport', stripe_checkout_session_id: 'cs_1' } })
  const session = airportSession()
  const first = await releaseFromCheckoutEvent(db, expiredEvent(session))
  assert.equal(first.released, true)
  assert.equal(first.status, 'canceled')
  assert.equal(db.trips.get('trip_1').status, 'canceled')
  assert.equal(db.trips.get('trip_1').metadata.purpose, 'airport')
  assert.equal(db.events.length, 1)
  assert.equal(db.events[0].kind, 'canceled')
  assert.equal(db.events[0].payload.reason, 'checkout_expired')
  assert.equal(db.events[0].payload.source, 'stripe_webhook')
  assert.equal(db.events[0].payload.checkout_session, 'cs_1')

  const second = await releaseFromCheckoutEvent(db, expiredEvent(session))
  assert.equal(second.released, false)
  assert.equal(second.reason, 'not_in_pool')
  assert.equal(db.events.length, 1)
  assert.equal(db.trips.get('trip_1').status, 'canceled')
})

test('a paid deposit stays searching when an expired webhook is replayed', async () => {
  const db = memoryDb()
  db.seedTrip({ id: 'trip_1', status: 'searching', metadata: { stripe_checkout_session_id: 'cs_1' } })
  db.payments.push({ id: 'pay_1', trip_id: 'trip_1', kind: 'deposit', status: 'succeeded', amount_cents: 2500 })
  const released = await releaseUnpaidCheckoutTrip(db, airportSession(), {
    reason: 'checkout_expired',
    source: 'stripe_webhook',
  })
  assert.equal(released.released, false)
  assert.equal(released.reason, 'paid')
  assert.equal(db.trips.get('trip_1').status, 'searching')
  assert.equal(db.events.length, 0)

  const again = await releaseUnpaidCheckoutTrip(db, airportSession({ status: 'complete', payment_status: 'paid' }), {
    reason: 'checkout_canceled',
    source: 'checkout_return',
  })
  assert.equal(again.reason, 'paid')
  assert.equal(again.released, false)
  assert.equal(db.trips.get('trip_1').status, 'searching')
  assert.equal(db.events.length, 0)
})

test('a deposited trip canceled by checkout is restored when the expired event replays', async () => {
  const db = memoryDb()
  db.seedTrip({
    id: 'trip_1',
    status: 'canceled',
    canceled_at: '2026-09-24T00:00:00.000Z',
    metadata: {
      stripe_checkout_session_id: 'cs_1',
      checkout_abandoned: { session_id: 'cs_1', reason: 'checkout_canceled' },
    },
  })
  db.payments.push({ trip_id: 'trip_1', kind: 'deposit', status: 'succeeded' })
  const result = await releaseFromCheckoutEvent(db, expiredEvent(airportSession()))
  assert.equal(result.released, false)
  assert.equal(result.reason, 'paid')
  assert.equal(result.restored, true)
  assert.equal(db.trips.get('trip_1').status, 'searching')
  assert.equal(db.trips.get('trip_1').canceled_at, null)
  assert.equal(db.events.at(-1).kind, 'searching')
  assert.equal(db.events.at(-1).payload.reason, 'deposit_paid')
})

test('an open unpaid session is expired before the trip leaves the pool', async () => {
  const db = memoryDb()
  db.seedTrip({ id: 'trip_1', status: 'searching', metadata: { stripe_checkout_session_id: 'cs_1' } })
  let expired = 0
  const result = await releaseUnpaidCheckoutTrip(db, airportSession({ status: 'open' }), {
    reason: 'checkout_canceled',
    source: 'checkout_return',
    expireSession: async () => {
      expired += 1
      return { id: 'cs_1', status: 'expired', payment_status: 'unpaid' }
    },
  })
  assert.equal(expired, 1)
  assert.equal(result.released, true)
  assert.equal(db.trips.get('trip_1').status, 'canceled')
  assert.equal(db.events[0].payload.reason, 'checkout_canceled')
  assert.equal(db.events[0].payload.source, 'checkout_return')

  const replay = await releaseUnpaidCheckoutTrip(db, airportSession({ status: 'expired' }), {
    reason: 'checkout_canceled',
    source: 'checkout_return',
    expireSession: async () => {
      throw new Error('should not expire twice')
    },
  })
  assert.equal(replay.released, false)
  assert.equal(replay.reason, 'not_in_pool')
  assert.equal(db.events.length, 1)
})

test('a session that completes while we try to expire it is not canceled', async () => {
  const db = memoryDb()
  db.seedTrip({ id: 'trip_1', status: 'searching', metadata: { stripe_checkout_session_id: 'cs_1' } })
  const result = await releaseUnpaidCheckoutTrip(db, airportSession({ status: 'open' }), {
    reason: 'checkout_canceled',
    source: 'checkout_return',
    expireSession: async () => {
      throw new Error('already complete')
    },
    retrieveSession: async () => airportSession({ status: 'complete', payment_status: 'paid' }),
  })
  assert.equal(result.reason, 'paid')
  assert.equal(result.released, false)
  assert.equal(db.trips.get('trip_1').status, 'searching')
  assert.equal(db.events.length, 0)
})

test('an open session stays searching until it can be expired', async () => {
  const db = memoryDb()
  db.seedTrip({ id: 'trip_1', status: 'offered', metadata: { stripe_checkout_session_id: 'cs_1' } })
  const held = await releaseUnpaidCheckoutTrip(db, airportSession({ status: 'open' }))
  assert.equal(held.reason, 'still_open')
  assert.equal(db.trips.get('trip_1').status, 'offered')
  assert.equal(db.events.length, 0)

  const released = await releaseUnpaidCheckoutTrip(db, airportSession({ status: 'expired' }))
  assert.equal(released.released, true)
  assert.equal(db.trips.get('trip_1').status, 'canceled')
})

test('a late paid deposit restores searching, and a second success does not cancel', async () => {
  const db = memoryDb()
  db.seedTrip({
    id: 'trip_1',
    status: 'searching',
    metadata: { purpose: 'airport', stripe_checkout_session_id: 'cs_1' },
  })
  await releaseUnpaidCheckoutTrip(db, airportSession(), { reason: 'checkout_expired', source: 'stripe_webhook' })
  assert.equal(db.trips.get('trip_1').status, 'canceled')
  const paid = airportSession({ status: 'complete', payment_status: 'paid' })
  const restored = await restoreLiveTripAfterDeposit(db, paid)
  assert.equal(restored.restored, true)
  assert.equal(restored.status, 'searching')
  assert.equal(db.trips.get('trip_1').canceled_at, null)
  assert.equal(db.trips.get('trip_1').metadata.checkout_abandoned, undefined)
  assert.equal(db.trips.get('trip_1').metadata.purpose, 'airport')
  assert.equal(db.trips.get('trip_1').metadata.checkout_deposit.session_id, 'cs_1')
  const again = await restoreLiveTripAfterDeposit(db, paid)
  assert.equal(again.restored, false)
  assert.equal(again.reason, 'already_live')
  db.payments.push({ trip_id: 'trip_1', kind: 'deposit', status: 'succeeded' })
  const replay = await releaseFromCheckoutEvent(db, expiredEvent(airportSession()))
  assert.equal(replay.released, false)
  assert.equal(replay.reason, 'paid')
  assert.equal(db.trips.get('trip_1').status, 'searching')
  assert.equal(db.events.filter((event) => event.kind === 'canceled').length, 1)
})

test('a dated unpaid checkout cancels, and a paid deposit restores scheduled', async () => {
  const db = memoryDb()
  db.seedTrip({
    id: 'trip_1',
    status: 'scheduled',
    scheduled_for: '2026-10-01T16:00:00.000Z',
    metadata: { stripe_checkout_session_id: 'cs_1' },
  })
  const released = await releaseUnpaidCheckoutTrip(db, airportSession(), { reason: 'checkout_expired' })
  assert.equal(released.released, true)
  assert.equal(db.trips.get('trip_1').status, 'canceled')
  const restored = await restoreLiveTripAfterDeposit(db, airportSession({ status: 'complete', payment_status: 'paid' }))
  assert.equal(restored.restored, true)
  assert.equal(restored.status, 'scheduled')
  assert.equal(db.trips.get('trip_1').status, 'scheduled')
  assert.equal(db.events.at(-1).kind, 'scheduled')
})

test('a paid deposit restores a checkout cancel, not a driver decline or mid-ride cancel', async () => {
  const db = memoryDb()
  db.seedTrip({ id: 'trip_1', status: 'canceled', metadata: {} })
  const declined = await restoreLiveTripAfterDeposit(db, airportSession({ status: 'complete', payment_status: 'paid' }))
  assert.equal(declined.restored, false)
  assert.equal(declined.reason, 'not_checkout_abandon')
  assert.equal(db.trips.get('trip_1').status, 'canceled')
  assert.equal(db.events.length, 0)

  db.seedTrip({
    id: 'trip_2',
    status: 'canceled',
    scheduled_for: null,
    metadata: { checkout_abandoned: { session_id: 'cs_old' } },
  })
  const retry = await restoreLiveTripAfterDeposit(db, airportSession({
    id: 'cs_new',
    status: 'complete',
    payment_status: 'paid',
    metadata: { tripId: 'trip_2' },
  }))
  assert.equal(retry.restored, true)
  assert.equal(retry.status, 'searching')
  assert.equal(db.trips.get('trip_2').status, 'searching')

  db.seedTrip({
    id: 'trip_3',
    status: 'canceled_midride',
    metadata: { checkout_abandoned: { session_id: 'cs_1' } },
  })
  const midride = await restoreLiveTripAfterDeposit(db, airportSession({
    status: 'complete',
    payment_status: 'paid',
    metadata: { tripId: 'trip_3' },
  }))
  assert.equal(midride.reason, 'left_closed')
  assert.equal(db.trips.get('trip_3').status, 'canceled_midride')
})

test('stale, pending, credit, requested, and accepted trips are not canceled', async () => {
  const db = memoryDb()
  db.seedTrip({ id: 'trip_1', status: 'searching', metadata: { stripe_checkout_session_id: 'cs_new' } })
  const stale = await releaseUnpaidCheckoutTrip(db, airportSession({ id: 'cs_old' }), { reason: 'checkout_expired' })
  assert.equal(stale.reason, 'stale_session')
  assert.equal(db.trips.get('trip_1').status, 'searching')

  const pending = await releaseUnpaidCheckoutTrip(db, airportSession({
    id: 'cs_new',
    status: 'complete',
    payment_status: 'unpaid',
  }))
  assert.equal(pending.reason, 'async_pending')
  assert.equal(db.trips.get('trip_1').status, 'searching')

  const failed = await releaseFromCheckoutEvent(db, {
    type: 'checkout.session.async_payment_failed',
    data: { object: airportSession({ id: 'cs_new', status: 'complete', payment_status: 'unpaid' }) },
  })
  assert.equal(failed.released, true)
  assert.equal(db.events.at(-1).payload.reason, 'checkout_async_failed')

  db.seedTrip({ id: 'trip_1', status: 'searching', metadata: { stripe_checkout_session_id: 'cs_new' } })
  const credit = await releaseUnpaidCheckoutTrip(db, airportSession({
    id: 'cs_new',
    metadata: { kind: 'credit_purchase', tripId: 'trip_1' },
  }))
  assert.equal(credit.reason, 'not_airport_deposit')
  assert.equal(db.trips.get('trip_1').status, 'searching')

  db.trips.get('trip_1').status = 'requested'
  const requested = await releaseUnpaidCheckoutTrip(db, airportSession({ id: 'cs_new' }))
  assert.equal(requested.reason, 'not_in_pool')
  assert.equal(db.trips.get('trip_1').status, 'requested')

  db.trips.get('trip_1').status = 'accepted'
  db.trips.get('trip_1').driver_id = 'driver_1'
  const accepted = await releaseUnpaidCheckoutTrip(db, airportSession({ id: 'cs_new' }))
  assert.equal(accepted.reason, 'driver_assigned')
  assert.equal(db.trips.get('trip_1').status, 'accepted')
  assert.equal(db.events.filter((event) => event.payload?.reason === 'checkout_async_failed').length, 1)
})

test('a checkout that never opens cancels only an unpaid pool trip', async () => {
  const db = memoryDb()
  db.seedTrip({ id: 'trip_1', status: 'searching' })
  const canceled = await cancelUnopenedCheckoutTrip(db, 'trip_1', {
    reason: 'checkout_create_failed',
    source: 'airport_checkout',
  })
  assert.equal(canceled.released, true)
  assert.equal(db.events[0].payload.reason, 'checkout_create_failed')
  assert.equal(db.trips.get('trip_1').status, 'canceled')

  db.seedTrip({ id: 'trip_2', status: 'searching' })
  db.payments.push({ trip_id: 'trip_2', kind: 'deposit', status: 'succeeded' })
  const kept = await cancelUnopenedCheckoutTrip(db, 'trip_2')
  assert.equal(kept.reason, 'paid')
  assert.equal(db.trips.get('trip_2').status, 'searching')
})

test('only the latest checkout session can cancel the trip', async () => {
  const db = memoryDb()
  db.seedTrip({ id: 'trip_1', status: 'searching', metadata: { airport: 'GSP' } })
  const remembered = await rememberCheckoutSession(db, 'trip_1', 'cs_new')
  assert.equal(remembered.ok, true)
  assert.equal(db.trips.get('trip_1').metadata.stripe_checkout_session_id, 'cs_new')
  assert.equal(db.trips.get('trip_1').metadata.airport, 'GSP')
  const old = await releaseUnpaidCheckoutTrip(db, airportSession({ id: 'cs_old' }))
  assert.equal(old.reason, 'stale_session')
  assert.equal(db.trips.get('trip_1').status, 'searching')
  const current = await releaseUnpaidCheckoutTrip(db, airportSession({ id: 'cs_new' }))
  assert.equal(current.released, true)
  assert.equal(db.trips.get('trip_1').status, 'canceled')
})

test('an unpaid session does not restore a canceled trip', async () => {
  const db = memoryDb()
  db.seedTrip({
    id: 'trip_1',
    status: 'canceled',
    metadata: { checkout_abandoned: { session_id: 'cs_1' } },
  })
  const restored = await restoreLiveTripAfterDeposit(db, airportSession())
  assert.equal(restored.reason, 'not_paid')
  assert.equal(db.trips.get('trip_1').status, 'canceled')
  assert.equal(db.events.length, 0)
})


test('a paid deposit on an already-live searching trip stamps checkout_deposit', async () => {
  const db = memoryDb()
  db.seedTrip({
    id: 'trip_1',
    status: 'searching',
    metadata: { purpose: 'airport', stripe_checkout_session_id: 'cs_1' },
  })
  const paid = airportSession({ status: 'complete', payment_status: 'paid' })
  const result = await restoreLiveTripAfterDeposit(db, paid)
  assert.equal(result.restored, false)
  assert.equal(result.reason, 'already_live')
  assert.equal(db.trips.get('trip_1').status, 'searching')
  assert.equal(db.trips.get('trip_1').metadata.checkout_deposit.session_id, 'cs_1')
  const again = await restoreLiveTripAfterDeposit(db, paid)
  assert.equal(again.reason, 'already_live')
  assert.equal(db.trips.get('trip_1').metadata.checkout_deposit.session_id, 'cs_1')
})

test('the stripe webhook releases expired checkouts and restores a paid deposit', () => {
  const webhook = readFileSync(new URL('../api/stripe-webhook.js', import.meta.url), 'utf8')
  assert.match(webhook, /checkout\.session\.expired/)
  assert.match(webhook, /checkout\.session\.async_payment_failed/)
  assert.match(webhook, /releaseFromCheckoutEvent/)
  assert.match(webhook, /restoreLiveTripAfterDeposit/)
  assert.match(webhook, /checkout_deposit/)
  const checkout = readFileSync(new URL('../api/create-checkout-session.js', import.meta.url), 'utf8')
  const airport = readFileSync(new URL('./endpoints/airportCheckout.js', import.meta.url), 'utf8')
  assert.match(checkout, /rememberCheckoutSession/)
  assert.match(checkout, /cancelUnopenedCheckoutTrip/)
  assert.match(airport, /rememberCheckoutSession/)
  assert.match(airport, /cancelUnopenedCheckoutTrip/)
})

const HOLD_NOW = Date.parse('2026-09-24T15:00:00.000Z')

function holdIso(ageMs) {
  return new Date(HOLD_NOW - ageMs).toISOString()
}

function seedAirportHold(db, overrides = {}) {
  const { metadata: metaOverrides, ...rest } = overrides
  db.seedTrip({
    id: 'trip_1',
    status: 'searching',
    deposit_cents: 2500,
    driver_id: null,
    created_at: holdIso(UNPAID_AIRPORT_HOLD_TTL_MS),
    ...rest,
    metadata: {
      purpose: 'airport',
      kind: 'airport',
      airport: 'GSP',
      stripe_checkout_session_id: 'cs_1',
      ...(metaOverrides || {}),
    },
  })
}

function mockRes() {
  return {
    statusCode: 0,
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

test('an unpaid airport hold is canceled at 20 minutes and kept one millisecond earlier', () => {
  const trip = {
    id: 'trip_1',
    status: 'searching',
    deposit_cents: 2500,
    driver_id: null,
    created_at: '2026-09-24T14:40:00.000Z',
    metadata: { purpose: 'airport', airport: 'GSP' },
  }
  const due = decideUnpaidAirportHoldTtl({ trip, payments: [], now: HOLD_NOW })
  assert.equal(due.action, 'cancel')
  assert.equal(due.reason, 'unpaid_hold_ttl')
  const young = { ...trip, created_at: '2026-09-24T14:40:00.001Z' }
  assert.equal(decideUnpaidAirportHoldTtl({ trip: young, payments: [], now: HOLD_NOW }).reason, 'within_ttl')
  const rebound = {
    ...trip,
    created_at: '2026-09-24T14:00:00.000Z',
    metadata: {
      purpose: 'airport',
      airport: 'GSP',
      stripe_checkout_created_at: '2026-09-24T14:50:00.000Z',
    },
  }
  assert.equal(decideUnpaidAirportHoldTtl({ trip: rebound, payments: [], now: HOLD_NOW }).reason, 'within_ttl')
})

test('ttl sweep cancels stale unpaid airport holds and leaves paid and non-airport trips', async () => {
  const db = memoryDb()
  seedAirportHold(db, { id: 'trip_old', created_at: holdIso(UNPAID_AIRPORT_HOLD_TTL_MS + 60_000) })
  seedAirportHold(db, {
    id: 'trip_scheduled',
    status: 'scheduled',
    scheduled_for: '2026-10-01T16:00:00.000Z',
    created_at: holdIso(30 * 60 * 1000),
    metadata: { kind: 'scheduled', airport: 'CLT', stripe_checkout_session_id: 'cs_sched' },
  })
  seedAirportHold(db, {
    id: 'trip_offered',
    status: 'offered',
    created_at: holdIso(25 * 60 * 1000),
    metadata: { stripe_checkout_session_id: 'cs_offered' },
  })
  seedAirportHold(db, { id: 'trip_young', created_at: holdIso(5 * 60 * 1000) })
  seedAirportHold(db, {
    id: 'trip_paid_row',
    created_at: holdIso(40 * 60 * 1000),
    metadata: { stripe_checkout_session_id: 'cs_paid' },
  })
  db.payments.push({ trip_id: 'trip_paid_row', kind: 'airport_deposit', status: 'succeeded', amount_cents: 2500 })
  seedAirportHold(db, {
    id: 'trip_stamped',
    created_at: holdIso(40 * 60 * 1000),
    metadata: { checkout_deposit: { session_id: 'cs_stamp' }, stripe_checkout_session_id: 'cs_stamp' },
  })
  seedAirportHold(db, {
    id: 'trip_fare_paid',
    created_at: holdIso(40 * 60 * 1000),
    metadata: { fare_paid_cents: 2500, stripe_checkout_session_id: 'cs_fare' },
  })
  seedAirportHold(db, {
    id: 'trip_fresh_session',
    created_at: holdIso(50 * 60 * 1000),
    metadata: { stripe_checkout_created_at: holdIso(5 * 60 * 1000), stripe_checkout_session_id: 'cs_fresh' },
  })
  db.seedTrip({
    id: 'trip_campus',
    status: 'searching',
    deposit_cents: 2500,
    created_at: holdIso(40 * 60 * 1000),
    metadata: { purpose: 'campus' },
  })
  db.seedTrip({
    id: 'trip_credits',
    status: 'searching',
    deposit_cents: 0,
    created_at: holdIso(40 * 60 * 1000),
    metadata: { purpose: 'airport', airport: 'GSP' },
  })
  db.seedTrip({
    id: 'trip_driver',
    status: 'searching',
    deposit_cents: 2500,
    driver_id: 'driver_1',
    created_at: holdIso(40 * 60 * 1000),
    metadata: { purpose: 'airport', airport: 'GSP' },
  })
  db.seedTrip({
    id: 'trip_requested',
    status: 'requested',
    deposit_cents: 2500,
    created_at: holdIso(40 * 60 * 1000),
    metadata: { purpose: 'airport', airport: 'GSP' },
  })

  const sweep = await releaseExpiredUnpaidAirportHolds(db, { now: HOLD_NOW })
  assert.equal(sweep.ok, true)
  assert.equal(sweep.released, 3)
  assert.equal(db.trips.get('trip_old').status, 'canceled')
  assert.equal(db.trips.get('trip_scheduled').status, 'canceled')
  assert.equal(db.trips.get('trip_offered').status, 'canceled')
  assert.equal(db.trips.get('trip_young').status, 'searching')
  assert.equal(db.trips.get('trip_paid_row').status, 'searching')
  assert.equal(db.trips.get('trip_stamped').status, 'searching')
  assert.equal(db.trips.get('trip_fare_paid').status, 'searching')
  assert.equal(db.trips.get('trip_fresh_session').status, 'searching')
  assert.equal(db.trips.get('trip_campus').status, 'searching')
  assert.equal(db.trips.get('trip_credits').status, 'searching')
  assert.equal(db.trips.get('trip_driver').status, 'searching')
  assert.equal(db.trips.get('trip_requested').status, 'requested')

  const canceledEvents = db.events.filter((event) => event.kind === 'canceled')
  assert.equal(canceledEvents.length, 3)
  assert.equal(canceledEvents.every((event) => event.payload.reason === 'unpaid_hold_ttl'), true)
  assert.equal(canceledEvents.every((event) => event.payload.source === 'hold_ttl'), true)
  assert.ok(db.trips.get('trip_old').metadata.checkout_abandoned)
  assert.equal(db.trips.get('trip_old').metadata.purpose, 'airport')

  const again = await releaseExpiredUnpaidAirportHolds(db, { now: HOLD_NOW })
  assert.equal(again.released, 0)
  assert.equal(db.events.filter((event) => event.kind === 'canceled').length, 3)

  const restored = await restoreLiveTripAfterDeposit(db, airportSession({
    id: 'cs_sched',
    status: 'complete',
    payment_status: 'paid',
    metadata: { tripId: 'trip_scheduled' },
  }))
  assert.equal(restored.restored, true)
  assert.equal(restored.status, 'scheduled')
  assert.equal(db.trips.get('trip_scheduled').status, 'scheduled')
  assert.equal(db.trips.get('trip_old').status, 'canceled')
})

test('ttl cancel is idempotent with the checkout expired webhook and a paid deposit restores', async () => {
  const db = memoryDb()
  seedAirportHold(db)
  const stale = { ...db.trips.get('trip_1') }
  const first = await releaseExpiredUnpaidAirportHold(db, stale, { now: HOLD_NOW })
  assert.equal(first.released, true)
  assert.equal(db.events[0].payload.reason, 'unpaid_hold_ttl')
  assert.equal(db.events[0].payload.checkout_session, 'cs_1')

  const second = await releaseExpiredUnpaidAirportHold(db, stale, { now: HOLD_NOW })
  assert.equal(second.released, false)
  assert.equal(second.reason, 'not_in_pool')
  assert.equal(db.events.length, 1)

  const webhook = await releaseFromCheckoutEvent(db, expiredEvent(airportSession()))
  assert.equal(webhook.released, false)
  assert.equal(webhook.reason, 'not_in_pool')
  assert.equal(db.events.length, 1)

  const restored = await restoreLiveTripAfterDeposit(db, airportSession({ status: 'complete', payment_status: 'paid' }))
  assert.equal(restored.restored, true)
  assert.equal(restored.status, 'searching')
  assert.equal(db.trips.get('trip_1').metadata.checkout_abandoned, undefined)
  assert.equal(db.trips.get('trip_1').metadata.checkout_deposit.session_id, 'cs_1')
})

test('a checkout webhook cancel is not canceled again by the ttl sweep', async () => {
  const db = memoryDb()
  seedAirportHold(db, { created_at: holdIso(40 * 60 * 1000) })
  const expired = await releaseFromCheckoutEvent(db, expiredEvent(airportSession()))
  assert.equal(expired.released, true)
  const sweep = await releaseExpiredUnpaidAirportHolds(db, { now: HOLD_NOW })
  assert.equal(sweep.scanned, 0)
  assert.equal(sweep.released, 0)
  assert.equal(db.events.length, 1)
  assert.equal(db.events[0].payload.reason, 'checkout_expired')
  assert.equal(db.trips.get('trip_1').status, 'canceled')
})

test('ttl expire closes an open Checkout session and does not cancel a paid or pending one', async () => {
  const db = memoryDb()
  seedAirportHold(db)
  let expired = 0
  const closed = await releaseExpiredUnpaidAirportHold(db, db.trips.get('trip_1'), {
    now: HOLD_NOW,
    retrieveSession: async () => airportSession({ status: 'open' }),
    expireSession: async () => {
      expired += 1
      return { id: 'cs_1', status: 'expired', payment_status: 'unpaid' }
    },
  })
  assert.equal(expired, 1)
  assert.equal(closed.released, true)
  assert.equal(db.events[0].payload.reason, 'unpaid_hold_ttl')
  assert.equal(db.events[0].payload.source, 'hold_ttl')

  seedAirportHold(db, { id: 'trip_paid', metadata: { stripe_checkout_session_id: 'cs_paid' } })
  const paid = await releaseExpiredUnpaidAirportHold(db, db.trips.get('trip_paid'), {
    now: HOLD_NOW,
    retrieveSession: async () => airportSession({
      id: 'cs_paid',
      status: 'complete',
      payment_status: 'paid',
      metadata: { tripId: 'trip_paid' },
    }),
  })
  assert.equal(paid.released, false)
  assert.equal(paid.reason, 'paid')
  assert.equal(db.trips.get('trip_paid').status, 'searching')

  seedAirportHold(db, { id: 'trip_pending', metadata: { stripe_checkout_session_id: 'cs_pending' } })
  const pending = await releaseExpiredUnpaidAirportHold(db, db.trips.get('trip_pending'), {
    now: HOLD_NOW,
    retrieveSession: async () => airportSession({
      id: 'cs_pending',
      status: 'complete',
      payment_status: 'unpaid',
      metadata: { tripId: 'trip_pending' },
    }),
  })
  assert.equal(pending.reason, 'async_pending')
  assert.equal(db.trips.get('trip_pending').status, 'searching')
  assert.equal(db.events.filter((event) => event.trip_id === 'trip_pending').length, 0)
})

test('a bound session that is not the airport deposit still drops the stale hold', async () => {
  const db = memoryDb()
  seedAirportHold(db)
  let expired = 0
  const result = await releaseExpiredUnpaidAirportHold(db, db.trips.get('trip_1'), {
    now: HOLD_NOW,
    retrieveSession: async () => airportSession({ metadata: { kind: 'credit_purchase' } }),
    expireSession: async () => {
      expired += 1
      return { id: 'cs_1', status: 'expired', payment_status: 'unpaid' }
    },
  })
  assert.equal(expired, 0)
  assert.equal(result.released, true)
  assert.equal(db.trips.get('trip_1').status, 'canceled')
  assert.equal(db.events[0].payload.source, 'hold_ttl')
})

test('a Stripe read failure still removes the stale unpaid hold', async () => {
  const db = memoryDb()
  seedAirportHold(db)
  const result = await releaseExpiredUnpaidAirportHold(db, db.trips.get('trip_1'), {
    now: HOLD_NOW,
    retrieveSession: async () => {
      throw new Error('stripe down')
    },
  })
  assert.equal(result.released, true)
  assert.equal(db.trips.get('trip_1').status, 'canceled')
  assert.equal(db.events[0].payload.reason, 'unpaid_hold_ttl')
  assert.equal(db.events[0].payload.source, 'hold_ttl')
})

test('the ttl sweep cancels the oldest holds first when the batch is capped', async () => {
  const db = memoryDb()
  seedAirportHold(db, { id: 'trip_newer', created_at: holdIso(21 * 60 * 1000) })
  seedAirportHold(db, { id: 'trip_oldest', created_at: holdIso(50 * 60 * 1000) })
  const sweep = await releaseExpiredUnpaidAirportHolds(db, { now: HOLD_NOW, limit: 1 })
  assert.equal(sweep.scanned, 1)
  assert.equal(sweep.released, 1)
  assert.equal(db.trips.get('trip_oldest').status, 'canceled')
  assert.equal(db.trips.get('trip_newer').status, 'searching')
})

test('remembering a checkout session records the bind time used as the ttl anchor', async () => {
  const db = memoryDb()
  db.seedTrip({ id: 'trip_1', status: 'searching', metadata: { airport: 'GSP', purpose: 'airport' } })
  const remembered = await rememberCheckoutSession(db, 'trip_1', 'cs_new', {
    createdAt: '2026-09-24T14:50:00.000Z',
  })
  assert.equal(remembered.ok, true)
  assert.equal(db.trips.get('trip_1').metadata.stripe_checkout_session_id, 'cs_new')
  assert.equal(db.trips.get('trip_1').metadata.stripe_checkout_created_at, '2026-09-24T14:50:00.000Z')
  assert.equal(db.trips.get('trip_1').metadata.airport, 'GSP')
})

test('hold ttl cron auth reuses CRON_SECRET and does not require a new secret', () => {
  const req = (headers) => ({ headers })
  assert.equal(holdTtlCronAuthorized(req({}), { CRON_SECRET: '' }), false)
  assert.equal(holdTtlCronAuthorized(req({ 'x-vercel-cron': '1' }), { CRON_SECRET: '' }), false)
  assert.equal(holdTtlCronAuthorized(req({ 'X-Vercel-Cron': '1' }), { CRON_SECRET: 'placeholder' }), false)
  assert.equal(
    holdTtlCronAuthorized(req({ 'x-vercel-cron': '1' }), { CRON_SECRET: '', VERCEL: '1' }),
    true,
  )
  assert.equal(
    holdTtlCronAuthorized(req({ 'X-Vercel-Cron': ' 1 ' }), { CRON_SECRET: 'placeholder', VERCEL: '1' }),
    true,
  )
  assert.equal(
    holdTtlCronAuthorized(req({ 'x-vercel-cron': '1' }), { CRON_SECRET: 'real-secret', VERCEL: '1' }),
    false,
  )
  assert.equal(holdTtlCronAuthorized(req({ 'x-vercel-cron': '1' }), { CRON_SECRET: 'real-secret' }), false)
  assert.equal(
    holdTtlCronAuthorized(req({ authorization: 'Bearer real-secret' }), { CRON_SECRET: 'real-secret' }),
    true,
  )
  assert.equal(
    holdTtlCronAuthorized(req({ Authorization: 'bearer real-secret' }), { CRON_SECRET: '  real-secret\n' }),
    true,
  )
  assert.equal(
    holdTtlCronAuthorized(req({ AUTHORIZATION: 'Bearer real-secreT' }), { CRON_SECRET: 'real-secret' }),
    false,
  )
  assert.equal(
    holdTtlCronAuthorized(req({ authorization: 'Bearer real-secret-extra' }), { CRON_SECRET: 'real-secret' }),
    false,
  )
  assert.equal(
    holdTtlCronAuthorized(req({ authorization: 'Bearer other', 'x-vercel-cron': '1' }), { CRON_SECRET: 'real-secret', VERCEL: '1' }),
    false,
  )
  assert.equal(holdTtlCronAuthorized(req({ authorization: 'Bearer placeholder' }), { CRON_SECRET: 'placeholder', VERCEL: '1' }), false)
})

test('the expire endpoint rejects non-cron callers and documents the cron path', async () => {
  const cronEnv = { CRON_SECRET: 'cron-secret' }
  const denied = mockRes()
  await expireUnpaidAirportHolds({
    method: 'POST',
    headers: {},
    url: '/api/expire-unpaid-airport-holds',
  }, denied, { env: { CRON_SECRET: '', VERCEL: '1' } })
  assert.equal(denied.statusCode, 401)
  assert.equal(JSON.parse(denied.body).error, 'Cron authorization required')

  const spoofed = mockRes()
  await expireUnpaidAirportHolds({
    method: 'POST',
    headers: { 'x-vercel-cron': '1' },
    url: '/api/expire-unpaid-airport-holds',
  }, spoofed, { env: { CRON_SECRET: '' } })
  assert.equal(spoofed.statusCode, 401)

  const wrongMethod = mockRes()
  await expireUnpaidAirportHolds({
    method: 'PUT',
    headers: { 'x-vercel-cron': '1' },
    url: '/api/expire-unpaid-airport-holds',
  }, wrongMethod, { env: { CRON_SECRET: '', VERCEL: '1' } })
  assert.equal(wrongMethod.statusCode, 405)

  const preflight = mockRes()
  await expireUnpaidAirportHolds({
    method: 'OPTIONS',
    headers: { origin: 'https://example.com' },
    url: '/api/expire-unpaid-airport-holds',
  }, preflight, { env: cronEnv })
  assert.equal(preflight.statusCode, 405)
  assert.equal(preflight.headers['access-control-allow-origin'], undefined)

  const logged = []
  const originalError = console.error
  console.error = (...args) => { logged.push(args.map(String).join(' ')) }
  try {
    const unavailable = mockRes()
    await expireUnpaidAirportHolds({
      method: 'GET',
      headers: { Authorization: 'Bearer cron-secret' },
      url: '/api/expire-unpaid-airport-holds',
    }, unavailable, { env: cronEnv, sb: null })
    assert.equal(unavailable.statusCode, 503)
    assert.equal(JSON.parse(unavailable.body).error, 'Service unavailable')
    assert.doesNotMatch(unavailable.body, /SERVICE_ROLE|stack/)
    assert.equal(logged.some((line) => line.includes('service role client unavailable')), true)
    const broken = mockRes()
    await expireUnpaidAirportHolds({
      method: 'POST',
      headers: { authorization: 'Bearer cron-secret' },
      url: '/api/expire-unpaid-airport-holds',
    }, broken, {
      env: cronEnv,
      sb: { marker: true },
      release: async () => {
        throw new Error('relation trips does not exist password=secret')
      },
    })
    assert.equal(broken.statusCode, 500)
    assert.deepEqual(JSON.parse(broken.body), { error: 'Could not expire unpaid holds' })
    assert.doesNotMatch(broken.body, /relation|password|secret/)
    assert.equal(logged.some((line) => line.includes('relation trips')), true)

    const listed = mockRes()
    await expireUnpaidAirportHolds({
      method: 'GET',
      headers: { authorization: 'Bearer cron-secret' },
      url: '/api/expire-unpaid-airport-holds',
    }, listed, {
      env: cronEnv,
      sb: {},
      release: async () => ({ ok: false, error: 'permission denied for table trips', reason: 'list_failed' }),
    })
    assert.equal(listed.statusCode, 500)
    assert.deepEqual(JSON.parse(listed.body), { error: 'Could not expire unpaid holds' })
  } finally {
    console.error = originalError
  }

  const counted = mockRes()
  await expireUnpaidAirportHolds({
    method: 'POST',
    headers: { authorization: 'Bearer cron-secret' },
    url: '/api/expire-unpaid-airport-holds?dry_run=1',
  }, counted, {
    env: cronEnv,
    sb: { marker: true },
    release: async (sb, opts) => {
      assert.equal(sb.marker, true)
      assert.equal(opts.dryRun, true)
      assert.equal(opts.expireSession, undefined)
      return {
        ok: true,
        scanned: 4,
        expired: 0,
        released: 0,
        skipped: 3,
        errors: 0,
        wouldExpire: 1,
        dryRun: true,
        results: [{ tripId: 'trip_1', wouldExpire: true }],
      }
    },
  })
  assert.equal(counted.statusCode, 200)
  assert.deepEqual(JSON.parse(counted.body), {
    ok: true,
    scanned: 4,
    expired: 0,
    released: 0,
    skipped: 3,
    errors: 0,
    wouldExpire: 1,
    dryRun: true,
    results: [{ tripId: 'trip_1', wouldExpire: true }],
  })
  assert.equal(counted.headers['access-control-allow-origin'], undefined)

  const endpoint = readFileSync(new URL('./endpoints/expireUnpaidAirportHolds.js', import.meta.url), 'utf8')
  const route = readFileSync(new URL('../api/expire-unpaid-airport-holds.js', import.meta.url), 'utf8')
  const notes = readFileSync(new URL('../SHIP_NOTES.md', import.meta.url), 'utf8')
  assert.match(endpoint, /\/api\/expire-unpaid-airport-holds/)
  assert.match(endpoint, /every 15 minutes/)
  assert.match(endpoint, /CRON_SECRET/)
  assert.match(endpoint, /x-vercel-cron/)
  assert.match(endpoint, /timingSafeEqual/)
  assert.match(endpoint, /VERCEL/)
  assert.match(endpoint, /dry_run/)
  assert.doesNotMatch(endpoint, /HOLD_TTL_SECRET|EXPIRE_HOLDS_SECRET/)
  assert.doesNotMatch(endpoint, /cors\(/)
  assert.match(route, /expireUnpaidAirportHolds/)
  assert.match(notes, /Authorization: Bearer \$CRON_SECRET/)
  assert.match(notes, /external cron/i)
  assert.match(notes, /safe to call repeatedly/)
  assert.doesNotMatch(notes, /"schedule": "\*\/15 \* \* \* \*"/)
})

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('overlapping ttl sweeps cancel once and expire an open Checkout session once', async () => {
  const db = memoryDb()
  seedAirportHold(db, { created_at: holdIso(40 * 60 * 1000) })
  let expires = 0
  const opts = {
    now: HOLD_NOW,
    retrieveSession: async () => {
      await pause(15)
      return airportSession({ status: 'open' })
    },
    expireSession: async () => {
      expires += 1
      await pause(40)
      return { id: 'cs_1', status: 'expired', payment_status: 'unpaid' }
    },
  }
  const [first, second] = await Promise.all([
    releaseExpiredUnpaidAirportHolds(db, opts),
    releaseExpiredUnpaidAirportHolds(db, opts),
  ])
  assert.equal(expires, 1)
  assert.equal(db.events.filter((event) => event.kind === 'canceled').length, 1)
  assert.equal(db.trips.get('trip_1').status, 'canceled')
  assert.equal(db.trips.get('trip_1').metadata.checkout_abandoned.reason, 'unpaid_hold_ttl')
  assert.equal(db.trips.get('trip_1').metadata.hold_expire_claim, undefined)
  assert.equal(first.released + second.released, 1)
  assert.equal(first.expired + second.expired, 1)
  assert.equal(first.errors + second.errors, 0)
})

test('overlapping ttl sweeps do not write two trip_events when Stripe is not called', async () => {
  const db = memoryDb()
  seedAirportHold(db, { created_at: holdIso(40 * 60 * 1000) })
  const [first, second] = await Promise.all([
    releaseExpiredUnpaidAirportHolds(db, { now: HOLD_NOW }),
    releaseExpiredUnpaidAirportHolds(db, { now: HOLD_NOW }),
  ])
  assert.equal(db.events.length, 1)
  assert.equal(db.trips.get('trip_1').status, 'canceled')
  assert.equal(first.released + second.released, 1)
})

test('a fresh expire claim blocks a second sweep and a stale claim can be taken over', async () => {
  const db = memoryDb()
  seedAirportHold(db, { created_at: holdIso(40 * 60 * 1000) })
  db.trips.get('trip_1').metadata = {
    ...db.trips.get('trip_1').metadata,
    hold_expire_claim: { at: new Date().toISOString() },
  }
  let expires = 0
  const blocked = await releaseExpiredUnpaidAirportHolds(db, {
    now: HOLD_NOW,
    retrieveSession: async () => airportSession({ status: 'open' }),
    expireSession: async () => {
      expires += 1
      return { id: 'cs_1', status: 'expired', payment_status: 'unpaid' }
    },
  })
  assert.equal(expires, 0)
  assert.equal(blocked.released, 0)
  assert.equal(blocked.results[0].reason, 'expire_in_progress')
  assert.equal(db.trips.get('trip_1').status, 'searching')
  assert.equal(db.events.length, 0)

  db.trips.get('trip_1').metadata = {
    ...db.trips.get('trip_1').metadata,
    hold_expire_claim: { at: new Date(Date.now() - 5 * 60 * 1000).toISOString() },
  }
  const taken = await releaseExpiredUnpaidAirportHolds(db, {
    now: HOLD_NOW,
    retrieveSession: async () => airportSession({ status: 'open' }),
    expireSession: async () => {
      expires += 1
      return { id: 'cs_1', status: 'expired', payment_status: 'unpaid' }
    },
  })
  assert.equal(expires, 1)
  assert.equal(taken.released, 1)
  assert.equal(db.events.length, 1)
  assert.equal(db.trips.get('trip_1').status, 'canceled')
})

test('ttl sweep does not touch paid deposits, zero deposits, non-airport trips, or paid Checkout sessions', async () => {
  const db = memoryDb()
  let expires = 0
  const expireSession = async () => {
    expires += 1
    return { status: 'expired', payment_status: 'unpaid' }
  }
  const paidSession = (id, tripId) => airportSession({
    id,
    status: 'complete',
    payment_status: 'paid',
    metadata: { tripId },
  })

  seedAirportHold(db, {
    id: 'trip_paid_deposit',
    created_at: holdIso(40 * 60 * 1000),
    metadata: { stripe_checkout_session_id: 'cs_dep' },
  })
  db.payments.push({ trip_id: 'trip_paid_deposit', kind: 'deposit', status: 'succeeded', amount_cents: 2500 })
  db.seedTrip({
    id: 'trip_zero',
    status: 'searching',
    deposit_cents: 0,
    created_at: holdIso(40 * 60 * 1000),
    metadata: { purpose: 'airport', airport: 'GSP', stripe_checkout_session_id: 'cs_zero' },
  })
  db.seedTrip({
    id: 'trip_campus',
    status: 'searching',
    deposit_cents: 2500,
    created_at: holdIso(40 * 60 * 1000),
    metadata: { purpose: 'campus', stripe_checkout_session_id: 'cs_campus' },
  })
  seedAirportHold(db, {
    id: 'trip_paid_session',
    created_at: holdIso(40 * 60 * 1000),
    metadata: { stripe_checkout_session_id: 'cs_paid_session' },
  })

  const paidDeposit = await releaseExpiredUnpaidAirportHold(db, db.trips.get('trip_paid_deposit'), {
    now: HOLD_NOW,
    expireSession,
    retrieveSession: async () => paidSession('cs_dep', 'trip_paid_deposit'),
  })
  assert.equal(paidDeposit.reason, 'paid')
  const zero = await releaseExpiredUnpaidAirportHold(db, db.trips.get('trip_zero'), {
    now: HOLD_NOW,
    expireSession,
    retrieveSession: async () => paidSession('cs_zero', 'trip_zero'),
  })
  assert.equal(zero.reason, 'not_airport_deposit')
  const campus = await releaseExpiredUnpaidAirportHold(db, db.trips.get('trip_campus'), {
    now: HOLD_NOW,
    expireSession,
    retrieveSession: async () => paidSession('cs_campus', 'trip_campus'),
  })
  assert.equal(campus.reason, 'not_airport_deposit')
  const paidCheckout = await releaseExpiredUnpaidAirportHold(db, db.trips.get('trip_paid_session'), {
    now: HOLD_NOW,
    expireSession,
    retrieveSession: async () => paidSession('cs_paid_session', 'trip_paid_session'),
  })
  assert.equal(paidCheckout.reason, 'paid')
  assert.equal(expires, 0)
  assert.equal(db.events.length, 0)
  assert.equal(db.trips.get('trip_paid_deposit').status, 'searching')
  assert.equal(db.trips.get('trip_zero').status, 'searching')
  assert.equal(db.trips.get('trip_campus').status, 'searching')
  assert.equal(db.trips.get('trip_paid_session').status, 'searching')

  const sweep = await releaseExpiredUnpaidAirportHolds(db, {
    now: HOLD_NOW,
    expireSession,
    retrieveSession: async (id) => paidSession(id, id === 'cs_paid_session' ? 'trip_paid_session' : 'trip_paid_deposit'),
  })
  assert.equal(sweep.expired, 0)
  assert.equal(sweep.errors, 0)
  assert.equal(expires, 0)
  assert.equal(db.events.filter((event) => event.kind === 'canceled').length, 0)
  assert.equal(db.trips.get('trip_zero').status, 'searching')
  assert.equal(db.trips.get('trip_campus').status, 'searching')
})

test('a Stripe expire error is reported and the rest of the batch still runs', async () => {
  const db = memoryDb()
  seedAirportHold(db, {
    id: 'trip_bad',
    created_at: holdIso(50 * 60 * 1000),
    metadata: { stripe_checkout_session_id: 'cs_bad' },
  })
  seedAirportHold(db, {
    id: 'trip_ok',
    created_at: holdIso(30 * 60 * 1000),
    metadata: { stripe_checkout_session_id: 'cs_ok' },
  })
  let expires = 0
  const sweep = await releaseExpiredUnpaidAirportHolds(db, {
    now: HOLD_NOW,
    retrieveSession: async (id) => airportSession({
      id,
      status: 'open',
      metadata: { tripId: id === 'cs_bad' ? 'trip_bad' : 'trip_ok' },
    }),
    expireSession: async (id) => {
      expires += 1
      if (id === 'cs_bad') throw new Error('stripe boom sk_live_should_not_abort')
      return { id, status: 'expired', payment_status: 'unpaid' }
    },
  })
  assert.equal(sweep.ok, true)
  assert.equal(sweep.scanned, 2)
  assert.equal(sweep.expired, 1)
  assert.equal(sweep.errors, 1)
  assert.equal(sweep.skipped, 0)
  assert.equal(db.trips.get('trip_ok').status, 'canceled')
  assert.equal(db.trips.get('trip_bad').status, 'searching')
  assert.equal(db.events.length, 1)
  assert.equal(db.events[0].trip_id, 'trip_ok')
  const failed = sweep.results.find((row) => row.tripId === 'trip_bad')
  assert.match(failed.error, /stripe boom/)
  assert.equal(db.trips.get('trip_bad').metadata.hold_expire_claim, undefined)

  const retry = await releaseExpiredUnpaidAirportHolds(db, {
    now: HOLD_NOW,
    retrieveSession: async (id) => airportSession({
      id,
      status: 'open',
      metadata: { tripId: 'trip_bad' },
    }),
    expireSession: async (id) => {
      expires += 1
      return { id, status: 'expired', payment_status: 'unpaid' }
    },
  })
  assert.equal(retry.expired, 1)
  assert.equal(db.trips.get('trip_bad').status, 'canceled')
  assert.equal(db.events.length, 2)
  assert.equal(expires, 3)
})

test('dry_run reports the hold it would expire and does not write', async () => {
  const db = memoryDb()
  seedAirportHold(db, {
    id: 'trip_due',
    created_at: holdIso(40 * 60 * 1000),
    metadata: { stripe_checkout_session_id: 'cs_due' },
  })
  seedAirportHold(db, {
    id: 'trip_paid',
    created_at: holdIso(40 * 60 * 1000),
    metadata: { stripe_checkout_session_id: 'cs_paid' },
  })
  let expires = 0
  const sweep = await releaseExpiredUnpaidAirportHolds(db, {
    now: HOLD_NOW,
    dryRun: true,
    retrieveSession: async (id) => airportSession({
      id,
      status: id === 'cs_paid' ? 'complete' : 'open',
      payment_status: id === 'cs_paid' ? 'paid' : 'unpaid',
      metadata: { tripId: id === 'cs_paid' ? 'trip_paid' : 'trip_due' },
    }),
    expireSession: async () => {
      expires += 1
      throw new Error('dry run must not expire')
    },
  })
  assert.equal(expires, 0)
  assert.equal(sweep.dryRun, true)
  assert.equal(sweep.wouldExpire, 1)
  assert.equal(sweep.expired, 0)
  assert.equal(sweep.released, 0)
  assert.equal(sweep.errors, 0)
  assert.equal(db.trips.get('trip_due').status, 'searching')
  assert.equal(db.trips.get('trip_paid').status, 'searching')
  assert.equal(db.events.length, 0)
  assert.equal(db.trips.get('trip_due').metadata.checkout_abandoned, undefined)
  assert.equal(db.trips.get('trip_due').metadata.hold_expire_claim, undefined)
})
