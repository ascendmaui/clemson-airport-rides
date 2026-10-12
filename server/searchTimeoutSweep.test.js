import test from 'node:test'
import assert from 'node:assert/strict'
import { sweepSearchTimeouts, searchTimeoutSkip, SEARCH_TIMEOUT_MS } from './searchTimeoutSweep.js'
import { SWEEPS } from './endpoints/tripSweeps.js'
import { tripStatusNoticeCopy, noticeIsCurrent, NOTICE_KINDS } from './tripStatusNotices.js'

const now = new Date('2026-10-12T12:00:00Z')
const ago = (min) => new Date(now.getTime() - min * 60000).toISOString()
const ahead = (min) => new Date(now.getTime() + min * 60000).toISOString()
const hold = (id) => ({ fare_authorization: { status: 'requires_capture', paymentIntentId: `pi_${id}` } })
const trip = (id, extra = {}) => ({ id, rider_id: `r_${id}`, driver_id: null, status: 'searching', created_at: ago(16), requested_at: null, pickup_at: null, scheduled_for: null, payment_status: 'pending', metadata: hold(id), ...extra })

function fakeDb(rows) {
  const tables = { trips: structuredClone(rows), trip_status_notices: [] }
  const sb = {
    tables,
    from(table) {
      const filters = []
      let patch = null
      const apply = () => tables[table].filter((r) => filters.every((f) => f(r)))
      const q = {
        select() { return q },
        update(p) { patch = p; return q },
        eq(c, v) { filters.push((r) => r[c] === v); return q },
        is(c, v) { filters.push((r) => (r[c] ?? null) === v); return q },
        lte(c, v) { filters.push((r) => r[c] <= v); return q },
        order() { return q },
        limit() { return Promise.resolve({ data: apply(), error: null }) },
        maybeSingle() {
          const hit = apply()[0]
          if (hit && patch) Object.assign(hit, patch)
          return Promise.resolve({ data: hit ? structuredClone(hit) : null, error: null })
        },
        upsert(row) {
          if (!tables[table].some((r) => r.dedupe_key === row.dedupe_key)) tables[table].push(row)
          return Promise.resolve({ error: null })
        },
      }
      return q
    },
  }
  return sb
}

test('search-timeout runs in trip-sweeps before the notice drain', () => {
  const names = SWEEPS.map((s) => s.name)
  assert.ok(names.includes('search-timeout'))
  assert.ok(names.indexOf('search-timeout') < names.indexOf('trip-status-notices'))
})

test('rider push copy for a search timeout', () => {
  assert.deepEqual(tripStatusNoticeCopy('search_timeout'), { title: 'Ride canceled', body: "No drivers were available. You weren't charged." })
  const notice = { kind: 'search_timeout', recipient_id: 'r1', driver_id: null }
  assert.equal(NOTICE_KINDS.search_timeout.role, 'rider')
  assert.equal(noticeIsCurrent(notice, { status: 'canceled', rider_id: 'r1', driver_id: null }), true)
  assert.equal(noticeIsCurrent(notice, { status: 'accepted', rider_id: 'r1', driver_id: 'd1' }), false)
})

test('cancels a ride searching 15+ minutes: releases hold, no_charge, notifies rider', async () => {
  const sb = fakeDb([trip('a')])
  const released = []
  const result = await sweepSearchTimeouts(sb, { now, releaseHold: async ({ trip: t, reason }) => { released.push([t.id, reason, t.status]); return { ok: true, released: true } } })
  const row = sb.tables.trips[0]
  assert.equal(row.status, 'canceled')
  assert.equal(row.payment_status, 'no_charge')
  assert.equal(row.metadata.cancel_reason, 'search_timeout')
  assert.deepEqual(released, [['a', 'search_timeout', 'canceled']])
  assert.deepEqual(result.ids.canceled, ['a'])
  assert.deepEqual(result.ids.released, ['a'])
  assert.equal(sb.tables.trip_status_notices.length, 1)
  assert.equal(sb.tables.trip_status_notices[0].kind, 'search_timeout')
  assert.equal(sb.tables.trip_status_notices[0].recipient_id, 'r_a')
  // Idempotent: a second tick does nothing.
  const again = await sweepSearchTimeouts(sb, { now, releaseHold: async () => assert.fail('no second release') })
  assert.equal(again.canceled, 0)
  assert.equal(sb.tables.trip_status_notices.length, 1)
})

test('leaves young, scheduled-not-due, backup-queue, released-scheduled and e2e rides alone', async () => {
  const rows = [
    trip('young', { created_at: ago(14) }),
    trip('sched', { scheduled_for: ahead(30), pickup_at: ahead(30) }),
    trip('backup', { metadata: { ...hold('backup'), backup_queue: { enabled: true, bonusCents: 1000, confirmState: 'handed_to_pool' } } }),
    trip('fresh_release', { created_at: ago(600), metadata: { ...hold('fresh_release'), scheduled_pickup_at: ago(5), scheduled_released_at: ago(20) } }),
    trip('e2e', { metadata: { e2e_test: true } }),
  ]
  const sb = fakeDb(rows)
  const result = await sweepSearchTimeouts(sb, { now, releaseHold: async () => assert.fail('must not release') })
  assert.equal(result.canceled, 0)
  assert.ok(sb.tables.trips.every((r) => r.status === 'searching'))
  assert.equal(sb.tables.trip_status_notices.length, 0)
  assert.equal(searchTimeoutSkip(rows[1], now), 'scheduled_not_due')
  assert.equal(searchTimeoutSkip(rows[2], now), 'backup_queue')
})

test('a due scheduled ride released 15+ minutes ago times out; released backup queue no longer blocks', async () => {
  const sb = fakeDb([
    trip('due', { created_at: ago(600), metadata: { ...hold('due'), scheduled_pickup_at: ago(16), scheduled_released_at: ago(30) } }),
    trip('bq', { metadata: { ...hold('bq'), backup_queue: { enabled: true, bonusCents: 1000, confirmState: 'released' } } }),
  ])
  const result = await sweepSearchTimeouts(sb, { now, releaseHold: async () => ({ ok: true, skipped: true }) })
  assert.deepEqual(result.ids.canceled.sort(), ['bq', 'due'])
  assert.equal(SEARCH_TIMEOUT_MS, 15 * 60 * 1000)
})

test('a failed hold release is reported but the cancel and notice stand', async () => {
  const sb = fakeDb([trip('f')])
  const result = await sweepSearchTimeouts(sb, { now, releaseHold: async () => ({ ok: false }) })
  assert.equal(sb.tables.trips[0].status, 'canceled')
  assert.deepEqual(result.ids.failed, ['f'])
  assert.equal(sb.tables.trip_status_notices.length, 1)
})

test('dry run changes nothing', async () => {
  const sb = fakeDb([trip('d')])
  const result = await sweepSearchTimeouts(sb, { now, dryRun: true, releaseHold: async () => assert.fail() })
  assert.equal(sb.tables.trips[0].status, 'searching')
  assert.equal(result.skipped, 1)
})
