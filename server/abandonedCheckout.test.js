import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  cancelUnopenedCheckoutTrip,
  releaseFromCheckoutEvent,
  releaseUnpaidCheckoutTrip,
  rememberCheckoutSession,
  restoreLiveTripAfterDeposit,
} from './abandonedCheckout.js'

function memoryDb() {
  const trips = new Map()
  const payments = []
  const events = []

  function match(row, filters) {
    return filters.every((filter) => {
      if (filter.type === 'eq') return row[filter.col] === filter.val
      if (filter.type === 'in') return filter.vals.includes(row[filter.col])
      if (filter.type === 'is') return filter.val == null ? row[filter.col] == null : row[filter.col] === filter.val
      return false
    })
  }

  function query(table) {
    const state = { table, filters: [], op: 'select', patch: null }
    const exec = () => {
      if (state.table === 'trip_events' && state.op === 'insert') {
        events.push(state.patch)
        return { data: state.patch, error: null }
      }
      if (state.table === 'payments') {
        return { data: payments.filter((row) => match(row, state.filters)), error: null }
      }
      if (state.table !== 'trips') return { data: null, error: { message: `unknown table ${state.table}` } }
      const rows = [...trips.values()].filter((row) => match(row, state.filters))
      if (state.op === 'update') {
        const updated = rows.map((row) => {
          const next = { ...row, ...state.patch }
          trips.set(next.id, next)
          return next
        })
        return { data: updated, error: null }
      }
      return { data: rows, error: null }
    }
    const api = {
      select() { return api },
      eq(col, val) { state.filters.push({ type: 'eq', col, val }); return api },
      in(col, vals) { state.filters.push({ type: 'in', col, vals }); return api },
      is(col, val) { state.filters.push({ type: 'is', col, val }); return api },
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

test('the stripe webhook releases expired checkouts and restores a paid deposit', () => {
  const webhook = readFileSync(new URL('../api/stripe-webhook.js', import.meta.url), 'utf8')
  assert.match(webhook, /checkout\.session\.expired/)
  assert.match(webhook, /checkout\.session\.async_payment_failed/)
  assert.match(webhook, /releaseFromCheckoutEvent/)
  assert.match(webhook, /restoreLiveTripAfterDeposit/)
  const checkout = readFileSync(new URL('../api/create-checkout-session.js', import.meta.url), 'utf8')
  const airport = readFileSync(new URL('./endpoints/airportCheckout.js', import.meta.url), 'utf8')
  assert.match(checkout, /rememberCheckoutSession/)
  assert.match(checkout, /cancelUnopenedCheckoutTrip/)
  assert.match(airport, /rememberCheckoutSession/)
  assert.match(airport, /cancelUnopenedCheckoutTrip/)
})
