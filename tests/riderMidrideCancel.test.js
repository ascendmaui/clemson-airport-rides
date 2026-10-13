import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { isMidrideEligible } from '../server/midrideFare.js'
import { loadMidrideStarted, riderMayCancelMidride } from '../shared/riderMidrideCancel.js'

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

const STATUSES = [
  'searching',
  'offered',
  'accepted',
  'arriving',
  'arrived',
  'in_progress',
  'completed',
  'canceled',
  'cancelled_wait',
  'canceled_midride',
  'scheduled',
]

test('rider Cancel follows the server mid-ride rule, including arriving after start', () => {
  for (const status of STATUSES) {
    for (const started of [false, true]) {
      assert.equal(
        riderMayCancelMidride(status, started),
        isMidrideEligible(status, { started }),
        `${status} started=${started}`,
      )
    }
  }
  assert.equal(riderMayCancelMidride('in_progress', false), true)
  assert.equal(riderMayCancelMidride('arriving', false), false)
  assert.equal(riderMayCancelMidride('arriving', true), true)
  assert.equal(riderMayCancelMidride('arrived', false), false)
  assert.equal(riderMayCancelMidride('arrived', true), true)
  assert.equal(riderMayCancelMidride('accepted', true), false)
  assert.equal(riderMayCancelMidride('arriving', 'true'), false)
})

test('started matches an in_progress trip event and fails closed', async () => {
  assert.equal(await loadMidrideStarted(null, { id: 't1', status: 'in_progress' }), true)
  assert.equal(await loadMidrideStarted(null, { id: 't1', status: 'arriving' }), false)
  assert.equal(await loadMidrideStarted({ from() { throw new Error('down') } }, { id: 't1', status: 'accepted' }), false)

  const calls = []
  const client = {
    from(table) {
      calls.push(['from', table])
      const query = {
        select(columns) { calls.push(['select', columns]); return query },
        eq(key, value) { calls.push(['eq', key, value]); return query },
        limit(count) { calls.push(['limit', count]); return Promise.resolve({ data: [{ id: 'event-1' }], error: null }) },
      }
      return query
    },
  }
  assert.equal(await loadMidrideStarted(client, { id: 'trip-1', status: 'arriving' }), true)
  assert.deepEqual(calls, [
    ['from', 'trip_events'],
    ['select', 'id'],
    ['eq', 'trip_id', 'trip-1'],
    ['eq', 'kind', 'in_progress'],
    ['limit', 1],
  ])

  const empty = {
    from() {
      const query = {
        select() { return query },
        eq() { return query },
        limit() { return Promise.resolve({ data: [], error: null }) },
      }
      return query
    },
  }
  assert.equal(await loadMidrideStarted(empty, { id: 'trip-1', status: 'arrived' }), false)

  const failed = {
    from() {
      const query = {
        select() { return query },
        eq() { return query },
        limit() { return Promise.resolve({ data: [{ id: 'event-1' }], error: { message: 'rls' } }) },
      }
      return query
    },
  }
  assert.equal(await loadMidrideStarted(failed, { id: 'trip-1', status: 'arriving' }), false)
})

test('both live-trip screens show Cancel from the shared rule and keep the confirm sheet', () => {
  const web = read('src/screens/Requested.jsx')
  const native = read('apps/rider/app/requested.tsx')
  const webSheet = read('src/components/MidrideCancelSheet.jsx')
  const nativeSheet = read('apps/rider/components/MidrideCancelSheet.tsx')
  const request = read('src/lib/midrideCancel.js')
  const endpoint = read('server/endpoints/tripCancelMidride.js')

  assert.match(web, /loadMidrideStarted\(supabase, \{ id: trip, status \}\)/)
  assert.match(web, /const canCancelMidride = riderMayCancelMidride\(status, midrideStarted\)/)
  assert.match(web, /\{canCancelMidride && trip && \(/)
  assert.match(web, /<MidrideCancelSheet/)
  assert.doesNotMatch(web, /isMidrideStatus\(status\)/)

  assert.match(native, /loadMidrideStarted\(supabase, \{ id: shown\?\.id \|\| tripId, status: shown\?\.status \}\)/)
  assert.match(native, /const canCancelMidride = riderMayCancelMidride\(shown\?\.status, midrideStarted\)/)
  assert.match(native, /\{canCancelMidride && tripId \?/)
  assert.match(native, /<MidrideCancelSheet/)
  assert.match(native, /setEndedTripId\(tripId\)/)

  assert.match(webSheet, /requestMidrideCancel\(\{ tripId, confirm: false \}\)/)
  assert.match(webSheet, /requestMidrideCancel\(\{ tripId, confirm: true \}\)/)
  assert.match(webSheet, /Confirm cancel and pay/)
  assert.match(nativeSheet, /requestMidrideCancel\(tripId, false\)/)
  assert.match(nativeSheet, /requestMidrideCancel\(tripId, true\)/)
  assert.match(nativeSheet, /\/api\/driver\?action=cancel-midride/)
  assert.match(nativeSheet, /Confirm cancel and pay/)
  assert.match(request, /body: \{ tripId, confirm \}/)

  assert.match(endpoint, /isMidrideEligible\(trip\.status, \{ started \}\)/)
  assert.match(endpoint, /\.eq\('kind', 'in_progress'\)/)
  assert.match(endpoint, /releaseOpenFareHold\(\{ sb, stripe: deps\.stripe, trip: endedTrip, reason: 'midride_cancel' \}\)/)
})
