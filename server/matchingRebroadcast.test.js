import assert from 'node:assert/strict'
import test from 'node:test'
import { rebroadcastMissedOffers } from './matchingRebroadcast.js'
import handler from '../api/driver.js'
import { seedMatchingScenario } from '../tests/fixtures/matchingE2E.js'
import { acceptTrip, loadDriverDesk } from '../packages/rides-native/driverDesk.js'

const now = new Date('2026-10-04T12:01:00.000Z')
function seed(overrides = {}) {
  return seedMatchingScenario({ trip: {
    offer_expires_at: now.toISOString(), deposit_cents: 0,
    metadata: { kind: 'driver_request', match: 'auto', offer_driver_id: 'driver-1', auto_assign_queue: ['driver-1', 'driver-2'], preserved: 'yes' },
    ...overrides,
  } })
}

test('unseen and seen offers advance at the deadline and old cards cannot accept', async () => {
  for (const status of ['searching', 'offered']) {
    const { supabase, trip } = seed({ status })
    const before = await rebroadcastMissedOffers(supabase, { now: new Date(now.getTime() - 1) })
    assert.equal(before.scanned, 0)
    const result = await rebroadcastMissedOffers(supabase, { now })
    assert.equal(result.advanced, 1)
    const stored = supabase._tables.trips[0]
    assert.equal(stored.status, 'searching')
    assert.equal(stored.driver_id, null)
    assert.equal(stored.metadata.offer_driver_id, 'driver-2')
    assert.equal(stored.metadata.preserved, 'yes')
    assert.deepEqual((await loadDriverDesk(supabase, 'driver-1')).offers, [])
    assert.equal((await loadDriverDesk(supabase, 'driver-2')).offers[0].id, trip.id)
    await assert.rejects(acceptTrip(supabase, trip, 'driver-1'), /no longer available/)
    await acceptTrip(supabase, trip, 'driver-2')
    assert.equal(supabase._tables.trip_events.length, 1)
    assert.equal(supabase._tables.trips[0].driver_id, 'driver-2')
    assert.equal((await rebroadcastMissedOffers(supabase, { now })).scanned, 0)
  }
})

test('rechecks online status, skips passes and rider, and includes newly online drivers', async () => {
  const { supabase } = seed()
  supabase._tables.driver_status[1].online = false
  for (const id of ['driver-3', 'driver-4', 'rider-1']) {
    supabase._tables.driver_status.push({ driver_id: id, online: true })
    supabase._tables.driver_applications.push({ profile_id: id, onboarding_status: 'approved' })
    supabase._tables.profiles.push({ id })
  }
  supabase._tables.driver_offer_passes.push({ driver_id: 'driver-3', trip_id: 'trip-searching-1' })
  assert.equal((await rebroadcastMissedOffers(supabase, { now })).advanced, 1)
  assert.equal(supabase._tables.trips[0].metadata.offer_driver_id, 'driver-4')
})

test('exhaustion releases to existing open pool; targeted Tesla waves require a Tesla', async () => {
  const { supabase } = seed({ tier: 'tesla' })
  const result = await rebroadcastMissedOffers(supabase, { now })
  assert.equal(result.released, 1)
  assert.equal(supabase._tables.trips[0].metadata.offer_driver_id, null)
  assert.equal(supabase._tables.trips[0].metadata.match, 'open')
  assert.equal(supabase._tables.trips[0].status, 'searching')
})

test('picked driver timeout also advances; dry run makes no changes', async () => {
  const { supabase } = seed({ metadata: { kind: 'driver_request', match: 'open', offer_driver_id: 'driver-1' } })
  const snapshot = structuredClone(supabase._tables)
  assert.equal((await rebroadcastMissedOffers(supabase, { now, dryRun: true })).wouldAdvance, 1)
  assert.deepEqual(supabase._tables, snapshot)
  assert.equal((await rebroadcastMissedOffers(supabase, { now })).advanced, 1)
})

test('overlapping sweeps have one winner and do not skip a target', async () => {
  const { supabase } = seed()
  const results = await Promise.all([
    rebroadcastMissedOffers(supabase, { now }), rebroadcastMissedOffers(supabase, { now }),
  ])
  assert.equal(results.reduce((sum, row) => sum + row.advanced, 0), 1)
  assert.equal(results.reduce((sum, row) => sum + row.skipped, 0), 1)
  assert.equal(supabase._tables.trips[0].metadata.offer_driver_id, 'driver-2')
})

for (const winner of ['accepted', 'canceled', 'pass', 'metadata']) {
  test(`a concurrent ${winner} wins without being overwritten`, async () => {
    const { supabase } = seed()
    const from = supabase.from
    supabase.from = (table) => {
      if (table === 'driver_status') {
        const row = supabase._tables.trips[0]
        if (winner === 'accepted' || winner === 'canceled') {
          row.status = winner
          row.driver_id = winner === 'accepted' ? 'driver-1' : null
        } else row.metadata = { ...row.metadata, ...(winner === 'pass' ? { offer_driver_id: 'driver-2' } : { unrelated: true }) }
      }
      return from(table)
    }
    const result = await rebroadcastMissedOffers(supabase, { now })
    assert.equal(result.skipped, 1)
    assert.equal(result.advanced + result.released, 0)
    assert.equal(supabase._tables.trips[0].metadata.offer_rebroadcast_at, undefined)
  })
}

test('terminal, assigned, scheduled and deposit rides are untouched', async () => {
  for (const patch of [{ status: 'accepted' }, { status: 'canceled' }, { driver_id: 'driver-1' }, { pickup_at: now.toISOString() }, { scheduled_for: now.toISOString() }, { deposit_cents: 100 }, { metadata: {} }]) {
    const { supabase } = seed(patch)
    const snapshot = structuredClone(supabase._tables)
    await rebroadcastMissedOffers(supabase, { now })
    assert.deepEqual(supabase._tables, snapshot)
  }
})

test('a failed eligibility lookup leaves the offer retryable', async () => {
  const { supabase } = seed()
  const from = supabase.from
  supabase.from = (table) => table === 'driver_status'
    ? { select: () => ({ eq: async () => ({ error: { message: 'lookup failed' } }) }) }
    : from(table)
  assert.equal((await rebroadcastMissedOffers(supabase, { now })).errors, 1)
  assert.equal(supabase._tables.trips[0].metadata.offer_driver_id, 'driver-1')
  supabase.from = from
  assert.equal((await rebroadcastMissedOffers(supabase, { now })).advanced, 1)
})

test('cron requires a real bearer secret; supports dry run, method and service errors', async () => {
  const { supabase } = seed()
  async function call(req, deps = {}) {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value }, end(body) { this.body = JSON.parse(body) } }
    await handler({ method: 'GET', url: '/api/driver?action=rebroadcast-offers', headers: {}, ...req }, res, { env: { CRON_SECRET: 'test-secret' }, sb: supabase, now, ...deps })
    assert.equal(res.headers['Cache-Control'], 'no-store')
    return res
  }
  assert.equal((await call({})).statusCode, 401)
  assert.equal((await call({ headers: { 'x-vercel-cron': '1' } }, { env: { VERCEL: '1' } })).statusCode, 401)
  assert.equal((await call({ headers: { authorization: 'Bearer wrong' } })).statusCode, 401)
  assert.equal((await call({
    headers: { authorization: ['Bearer test-secret', 'Bearer test-secret'] },
    url: '/api/driver?action=rebroadcast-offers&dry_run=1',
  })).statusCode, 200)
  assert.equal((await call({ method: 'DELETE' })).statusCode, 405)
  const headers = { authorization: 'Bearer test-secret' }
  assert.equal((await call({ headers }, { sb: null })).statusCode, 503)
  const dry = await call({ headers, url: '/api/driver?action=rebroadcast-offers&dry_run=1' })
  assert.equal(dry.statusCode, 200)
  assert.equal(dry.body.wouldAdvance, 1)
  assert.equal(supabase._tables.trips[0].metadata.offer_driver_id, 'driver-1')
  assert.equal((await call({ headers, method: 'POST' })).body.advanced, 1)
})

test('tried targets and unapproved online drivers are not selected again', async () => {
  const { supabase } = seed()
  supabase._tables.trips[0].metadata.offer_tried_driver_ids = ['driver-2']
  supabase._tables.driver_status.push({ driver_id: 'driver-pending', online: true })
  supabase._tables.driver_applications.push({ profile_id: 'driver-pending', onboarding_status: 'pending_review' })
  supabase._tables.profiles.push({ id: 'driver-pending', role: 'driver' })
  assert.equal((await rebroadcastMissedOffers(supabase, { now })).released, 1)
  assert.equal(supabase._tables.trips[0].metadata.offer_driver_id, null)
})

test('due batch is bounded and ordered oldest first', async () => {
  const { supabase, trip } = seed()
  supabase._tables.trips.push({ ...trip, id: 'older', offer_expires_at: '2026-10-04T12:00:00.000Z' })
  const result = await rebroadcastMissedOffers(supabase, { now, limit: 1 })
  assert.equal(result.scanned, 1)
  assert.equal(result.advanced, 1)
  assert.equal(supabase._tables.trips[0].metadata.offer_driver_id, 'driver-1')
  assert.equal(supabase._tables.trips[1].metadata.offer_driver_id, 'driver-2')
})
