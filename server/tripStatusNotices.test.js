import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DRIVER_STATUS_PUSH_FEATURE,
  noticeIsCurrent,
  sweepTripStatusNotices,
  tripStatusNoticeCopy,
  vehicleLine,
} from './tripStatusNotices.js'

/** Tiny in-memory PostgREST-ish client: eq/is/gte/lt/order/limit/select/update/delete/maybeSingle. */
function fakeDb(tables) {
  function query(table) {
    const filters = []
    let op = 'select'
    let patch = null
    let limit = null
    const rows = () => (tables[table] || []).filter((row) => filters.every((f) => f(row)))
    const run = () => {
      if (op === 'update') {
        const hit = rows()
        for (const row of hit) Object.assign(row, patch)
        return { data: hit.map((row) => ({ ...row })), error: null }
      }
      if (op === 'delete') {
        tables[table] = (tables[table] || []).filter((row) => !filters.every((f) => f(row)))
        return { data: null, error: null }
      }
      const hit = rows()
      return { data: (limit == null ? hit : hit.slice(0, limit)).map((row) => ({ ...row })), error: null }
    }
    const builder = {
      select() { return builder },
      update(value) { op = 'update'; patch = value; return builder },
      delete() { op = 'delete'; return builder },
      eq(col, value) { filters.push((row) => row[col] === value); return builder },
      is(col, value) { filters.push((row) => (row[col] ?? null) === value); return builder },
      gte(col, value) { filters.push((row) => String(row[col]) >= value); return builder },
      lt(col, value) { filters.push((row) => String(row[col]) < value); return builder },
      order() { return builder },
      limit(n) { limit = n; return builder },
      maybeSingle() { const result = run(); return Promise.resolve({ data: result.data?.[0] || null, error: null }) },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
    }
    return builder
  }
  return { from: query, tables }
}

const now = new Date('2026-10-09T15:00:00Z')
const recent = new Date(now.getTime() - 5_000).toISOString()

function seed(overrides = {}) {
  return fakeDb({
    trip_status_notices: [
      { id: 1, trip_id: 't1', kind: 'driver_en_route', recipient_id: 'r1', recipient_role: 'rider', driver_id: 'd1', created_at: recent, claimed_at: null, sent_at: null, attempts: 0 },
      { id: 2, trip_id: 't1', kind: 'arrive_prompt', recipient_id: 'd1', recipient_role: 'driver', driver_id: 'd1', created_at: recent, claimed_at: null, sent_at: null, attempts: 0 },
    ],
    trips: [{ id: 't1', status: 'arriving', rider_id: 'r1', driver_id: 'd1', pickup_label: 'Cooper Library' }],
    profiles: [{ id: 'd1', full_name: 'Alex Rivera' }],
    vehicles: [{ driver_id: 'd1', color: 'Silver', make: 'Honda', model: 'Civic', plate: 'abc123' }],
    rider_push_tokens: [{ rider_id: 'r1', token: 'ExponentPushToken[rider]' }],
    driver_push_tokens: [{ driver_id: 'd1', token: 'ExponentPushToken[driver]', features: [DRIVER_STATUS_PUSH_FEATURE] }],
    ...overrides,
  })
}

test('copy names the driver and car, and never mentions a fleet brand', () => {
  assert.deepEqual(tripStatusNoticeCopy('driver_en_route', { driverName: 'Alex Rivera', pickupLabel: 'Cooper Library', vehicle: 'Silver Honda Civic · ABC123' }), {
    title: 'Alex is on the way',
    body: 'Silver Honda Civic · ABC123. Heading to Cooper Library.',
  })
  assert.equal(tripStatusNoticeCopy('driver_arriving', { driverName: 'Alex' }).title, 'Alex is about 1 min away')
  assert.match(tripStatusNoticeCopy('driver_arrived', { driverName: 'Alex', pickupLabel: 'Cooper' }).body, /free for 3 minutes, then \$1 a minute/)
  assert.equal(tripStatusNoticeCopy('arrive_prompt', { pickupLabel: 'Cooper' }).title, 'Arrived at pickup?')
  assert.equal(tripStatusNoticeCopy('driver_en_route', {}).title, 'Your driver is on the way')
  assert.equal(tripStatusNoticeCopy('nope', {}), null)
  assert.equal(vehicleLine({ color: 'Blue', make: 'Ford', model: 'Focus', plate: 'x1' }), 'Blue Ford Focus · X1')
  assert.equal(vehicleLine(null), '')
})

test('a notice is current only for its trip status, driver and recipient', () => {
  const trip = { status: 'arriving', rider_id: 'r1', driver_id: 'd1' }
  assert.equal(noticeIsCurrent({ kind: 'driver_arriving', recipient_id: 'r1', driver_id: 'd1' }, trip), true)
  assert.equal(noticeIsCurrent({ kind: 'driver_arriving', recipient_id: 'r1', driver_id: 'd1' }, { ...trip, status: 'arrived' }), false)
  assert.equal(noticeIsCurrent({ kind: 'driver_en_route', recipient_id: 'r1', driver_id: 'd2' }, trip), false)
  assert.equal(noticeIsCurrent({ kind: 'arrive_prompt', recipient_id: 'd1', driver_id: 'd1' }, trip), true)
  assert.equal(noticeIsCurrent({ kind: 'arrive_prompt', recipient_id: 'r1', driver_id: 'd1' }, trip), false)
  assert.equal(noticeIsCurrent({ kind: 'unknown' }, trip), false)
  assert.equal(noticeIsCurrent({ kind: 'driver_arrived' }, null), false)
})

test('the sweep sends each pending notice once to the right token and channel', async () => {
  const db = seed()
  const sent = []
  const sendPush = async (message) => { sent.push(message); return { sent: true } }
  const result = await sweepTripStatusNotices(db, { now, sendPush })
  assert.equal(result.sent, 2)
  assert.deepEqual(sent.map((m) => [m.to, m.channelId, m.data.kind]), [
    ['ExponentPushToken[rider]', 'trip-status', 'driver_en_route'],
    ['ExponentPushToken[driver]', 'ride-requests', 'arrive_prompt'],
  ])
  assert.equal(sent[0].title, 'Alex is on the way')
  assert.deepEqual(sent[0].data, { tripId: 't1', kind: 'driver_en_route', status: 'arriving' })
  assert.ok(db.tables.trip_status_notices.every((row) => row.sent_at && row.result === 'sent' && row.attempts === 1))
  const again = await sweepTripStatusNotices(db, { now, sendPush })
  assert.equal(again.sent, 0)
  assert.equal(sent.length, 2)
})

test('stale notices, older driver builds and missing tokens are recorded and skipped', async () => {
  const db = seed({
    trips: [{ id: 't1', status: 'arrived', rider_id: 'r1', driver_id: 'd1', pickup_label: 'Cooper' }],
    driver_push_tokens: [{ driver_id: 'd1', token: 'ExponentPushToken[old-build]', features: [] }],
  })
  db.tables.trip_status_notices.push({ id: 3, trip_id: 't1', kind: 'driver_arrived', recipient_id: 'r1', recipient_role: 'rider', driver_id: 'd1', created_at: recent, claimed_at: null, sent_at: null, attempts: 0 })
  db.tables.rider_push_tokens = []
  const sent = []
  const result = await sweepTripStatusNotices(db, { now, sendPush: async (m) => { sent.push(m); return { sent: true } } })
  assert.equal(sent.length, 0)
  assert.equal(result.skipped, 3)
  assert.deepEqual(db.tables.trip_status_notices.map((row) => row.result), ['stale', 'stale', 'no_token'])
})

test('old builds without the feature get no status push even when current', async () => {
  const db = seed({ driver_push_tokens: [{ driver_id: 'd1', token: 'ExponentPushToken[old-build]' }] })
  const sent = []
  await sweepTripStatusNotices(db, { now, sendPush: async (m) => { sent.push(m); return { sent: true } } })
  assert.deepEqual(sent.map((m) => m.data.kind), ['driver_en_route'])
  assert.equal(db.tables.trip_status_notices[1].result, 'no_token')
})

test('claimed rows are left to their claimer, expired rows are ignored, dry runs send nothing', async () => {
  const db = seed()
  db.tables.trip_status_notices[0].claimed_at = new Date(now.getTime() - 10_000).toISOString()
  db.tables.trip_status_notices[1].created_at = new Date(now.getTime() - 20 * 60_000).toISOString()
  const sent = []
  const result = await sweepTripStatusNotices(db, { now, sendPush: async (m) => { sent.push(m); return { sent: true } } })
  assert.equal(sent.length, 0)
  assert.equal(result.sent + result.skipped, 0)
  const dry = await sweepTripStatusNotices(seed(), { now, dryRun: true, sendPush: () => assert.fail('dry run must not send') })
  assert.equal(dry.skipped, 2)
})

test('a push failure is recorded on the row without failing the sweep', async () => {
  const db = seed()
  const result = await sweepTripStatusNotices(db, { now, sendPush: async () => ({ sent: false, reason: 'device_not_registered' }) })
  assert.equal(result.sent, 0)
  assert.equal(result.skipped, 2)
  assert.equal(db.tables.trip_status_notices[0].result, 'device_not_registered')
})

test('a missing outbox table (migration not applied yet) is a no-op', async () => {
  const sb = { from: () => ({ select: () => ({ is: () => ({ gte: () => ({ order: () => ({ limit: async () => ({ data: null, error: { code: '42P01', message: 'relation "public.trip_status_notices" does not exist' } }) }) }) }) }) }) }
  const result = await sweepTripStatusNotices(sb, { now })
  assert.equal(result.unavailable, true)
})
