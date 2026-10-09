import assert from 'node:assert/strict'
import test from 'node:test'
import { sweepCanceledHolds } from './canceledHoldSweep.js'
import driver from '../api/driver.js'
import sweeps from './endpoints/tripSweeps.js'
import { seedHold, fakeStripe, call } from '../tests/fixtures/cancelFareHolds.js'

const now = new Date('2026-10-09T16:00:00Z')
const env = { CRON_SECRET: 'test-cron-secret' }
const auth = { authorization: 'Bearer test-cron-secret' }
function row(id, status, canceled_at, hold = 'requires_capture') {
  return { id, status, canceled_at, metadata: hold ? { fare_authorization: { status: hold, paymentIntentId: `pi_${id}` } } : {} }
}

function sweepDb(rows) {
  const { sb } = seedHold()
  sb._tables.trips.splice(0, 1, ...structuredClone(rows))
  const from = sb.from
  const queries = []
  sb.from = (table) => {
    const query = from(table)
    const select = query.select
    query.select = (columns, ...args) => {
      if (columns !== 'id, status, canceled_at, metadata') return select(columns, ...args)
      assert.equal(table, 'trips')
      const operations = []
      queries.push(operations)
      let selected = [...sb._tables.trips]
      const selection = {
        in(column, values) {
          operations.push(['in', column, values]); selected = selected.filter((r) => values.includes(r[column])); return selection
        },
        eq(column, value) {
          operations.push(['eq', column, value])
          assert.equal(column, 'metadata->fare_authorization->>status')
          selected = selected.filter((r) => r.metadata?.fare_authorization?.status === value); return selection
        },
        or(expression) {
          operations.push(['or', expression])
          const cutoff = expression.match(/^canceled_at\.lt\.(.*),canceled_at\.is\.null$/)[1]
          selected = selected.filter((r) => r.canceled_at == null || r.canceled_at < cutoff); return selection
        },
        order(column, options) {
          operations.push(['order', column, options])
          selected.sort((a, b) => (a.canceled_at || '').localeCompare(b.canceled_at || '')); return selection
        },
        limit(count) { operations.push(['limit', count]); selected = selected.slice(0, count); return selection },
        then(resolve, reject) { return Promise.resolve({ data: structuredClone(selected), error: null }).then(resolve, reject) },
      }
      return selection
    }
    return query
  }
  return { sb, queries }
}

function multiStripe({ fail = [] } = {}) {
  const canceled = new Set()
  const calls = []
  return { calls, paymentIntents: {
    retrieve: async (id) => ({ id, status: canceled.has(id) ? 'canceled' : 'requires_capture' }),
    cancel: async (id) => {
      calls.push(id)
      if (fail.includes(id)) throw new Error('Stripe unavailable')
      canceled.add(id)
      return { id, status: 'canceled' }
    },
  } }
}

test('sweep selects only terminal open holds older than two minutes or with null canceled_at', async () => {
  const { sb, queries } = sweepDb([
    row('normal', 'canceled', '2026-10-09T15:57:59Z'),
    row('midride', 'canceled_midride', null),
    row('wait', 'cancelled_wait', '2026-10-09T15:50:00Z'),
    row('recent', 'canceled', '2026-10-09T15:59:00Z'),
    row('boundary', 'canceled', '2026-10-09T15:58:00.000Z'),
    row('captured', 'canceled', null, 'captured'), row('missing', 'canceled', null, null),
    row('active', 'in_progress', null), row('promoted', 'scheduled', null), row('pool', 'searching', null),
  ])
  const stripe = multiStripe()
  const result = await sweepCanceledHolds(sb, { now, stripe })
  assert.equal(result.released, 3)
  assert.equal(result.failed, 0)
  assert.equal(result.skipped, 0)
  assert.deepEqual(new Set(result.ids.released), new Set(['normal', 'midride', 'wait']))
  assert.deepEqual(queries[0], [
    ['in', 'status', ['canceled', 'canceled_midride', 'cancelled_wait']],
    ['eq', 'metadata->fare_authorization->>status', 'requires_capture'],
    ['or', 'canceled_at.lt.2026-10-09T15:58:00.000Z,canceled_at.is.null'],
    ['order', 'canceled_at', { ascending: true, nullsFirst: true }], ['limit', 25],
  ])
  assert.equal((await sweepCanceledHolds(sb, { now, stripe })).released, 0)
  assert.equal(stripe.calls.length, 3)
  for (const id of result.ids.released) assert.equal(sb._tables.trips.find((r) => r.id === id).metadata.fare_authorization.reason, 'cancel_sweep')
})

test('sweep caps work at 25 and isolates failures and missing intent ids', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(String(i), 'canceled', null))
  delete rows[1].metadata.fare_authorization.paymentIntentId
  const { sb } = sweepDb(rows)
  const stripe = multiStripe({ fail: ['pi_0'] })
  const result = await sweepCanceledHolds(sb, { now, stripe })
  assert.equal(result.released, 23)
  assert.equal(result.failed, 1)
  assert.equal(result.skipped, 1)
  assert.deepEqual(result.ids.failed, ['0'])
  assert.deepEqual(result.ids.skipped, ['1'])
  assert.equal(stripe.calls.length, 24)
})

for (const headers of [{}, { authorization: 'Bearer wrong-secret' }, { authorization: 'Bearer test-cron-secrex' }, { 'x-vercel-cron': '1' }]) {
  test(`trip-sweeps rejects invalid bearer ${JSON.stringify(headers)}`, async () => {
    const sb = { from() { throw new Error('Must not access the database') } }
    const response = await call(driver, {}, { sb, env }, { method: 'GET', url: '/api/driver?action=trip-sweeps', headers })
    assert.equal(response.statusCode, 401)
  })
}

test('trip-sweeps follows matching auth header parsing and returns counts and ids', async () => {
  for (const headers of [auth, { Authorization: ['Bearer test-cron-secret', 'Bearer wrong'] }, { AUTHORIZATION: 'bearer "test-cron-secret"' }]) {
    const { sb } = sweepDb([row('ended', 'canceled', null)])
    const stripe = multiStripe()
    const response = await call(driver, {}, { sb, stripe, env, now }, { method: 'GET', url: '/api/driver?action=trip-sweeps', headers })
    assert.equal(response.statusCode, 200)
    assert.equal(response.body.released, 1)
    assert.deepEqual(response.body.ids, { released: ['ended'], failed: [], skipped: [] })
  }
})

test('trip-sweeps staging guard blocks writes and permits only configured dry runs', async () => {
  const { sb } = sweepDb([row('ended', 'canceled', null)])
  const stripe = multiStripe()
  const deps = { sb, stripe, now, env: { ...env, DISABLE_CRON_ENDPOINTS: '1' } }
  assert.equal((await call(sweeps, {}, deps, { headers: auth })).statusCode, 403)
  assert.equal((await call(sweeps, {}, deps, { headers: auth, url: '/?dry_run=1' })).statusCode, 403)
  const response = await call(sweeps, {}, { ...deps, env: { ...deps.env, ALLOW_STAGING_DRY_RUN: '1' } }, { headers: auth, url: '/?dry_run=1' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.skipped, 1)
  assert.equal(stripe.calls.length, 0)
  assert.equal(sb._tables.trips[0].metadata.fare_authorization.status, 'requires_capture')
})

test('named sweeps isolate errors and run the next sweep', async () => {
  const response = await call(sweeps, {}, { sb: {}, env, sweeps: [
    { name: 'broken', run: async () => { throw new Error('Database unavailable') } },
    { name: 'next', run: async () => ({ released: 1, failed: 0, skipped: 0, ids: { released: ['trip-1'] } }) },
  ] }, { headers: auth })
  assert.equal(response.statusCode, 500)
  assert.equal(response.body.released, 1)
  assert.ok(response.body.sweeps.broken.error)
  assert.equal(response.body.sweeps.next.released, 1)
})

test('trip-sweeps reports per-trip failures while continuing the batch', async () => {
  const { sb } = sweepDb([row('failed', 'canceled', null), row('released', 'cancelled_wait', null)])
  const response = await call(sweeps, {}, { sb, stripe: multiStripe({ fail: ['pi_failed'] }), env, now }, { headers: auth })
  assert.equal(response.statusCode, 500)
  assert.equal(response.body.released, 1)
  assert.equal(response.body.failed, 1)
  assert.deepEqual(response.body.ids.failed, ['failed'])
})

test('trip-sweeps fails cleanly when selection fails', async () => {
  const sb = { from() { throw new Error('Selection unavailable') } }
  const response = await call(sweeps, {}, { sb, env }, { headers: auth })
  assert.equal(response.statusCode, 500)
  assert.ok(response.body.sweeps.canceled_holds.error)
})

test('trip-sweeps rejects missing or placeholder secrets and unsupported methods', async () => {
  for (const CRON_SECRET of ['', 'placeholder-secret']) {
    const response = await call(sweeps, {}, { sb: {}, env: { CRON_SECRET } }, { headers: auth })
    assert.equal(response.statusCode, 401)
  }
  const response = await call(sweeps, {}, { sb: {}, env }, { method: 'DELETE', headers: auth })
  assert.equal(response.statusCode, 405)
})
