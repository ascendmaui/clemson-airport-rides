import test from 'node:test'
import assert from 'node:assert/strict'
import { driverCancelNotice, DRIVER_CANCELED_RIDER_COPY } from './liveTrip.js'
import { driverCancelTrip } from './driverDesk.js'

const first = '2026-10-09T16:00:00Z', next = '2026-10-09T16:10:00Z'
const trip = (status = 'searching', entries = [{ at: first }, { at: next }]) => ({ status, metadata: { driver_cancels: entries } })
test('searching gets the latest unseen driver cancellation; repeats and other statuses do not announce', () => {
  assert.deepEqual(driverCancelNotice(trip()), { at: next, message: DRIVER_CANCELED_RIDER_COPY })
  assert.deepEqual(driverCancelNotice(trip(), first), { at: next, message: DRIVER_CANCELED_RIDER_COPY })
  assert.equal(driverCancelNotice(trip(), next), null)
  assert.equal(driverCancelNotice(trip(), '2026-10-10T16:00:00Z'), null)
  for (const status of ['offered', 'accepted', 'arriving', 'arrived', 'in_progress', 'canceled', 'completed']) assert.equal(driverCancelNotice(trip(status)), null)
  for (const value of [null, {}, { status: 'searching' }, trip('searching', []), trip('searching', 'bad'), trip('searching', [{ at: 'bad' }])]) assert.equal(driverCancelNotice(value), null)
  assert.equal(driverCancelNotice(trip(), 'bad').at, next)
  assert.equal(DRIVER_CANCELED_RIDER_COPY, "Your driver had to cancel. We're finding you another driver now. You won't be charged for this.")
})

test('driverCancelTrip posts the new op, authenticated reason and note, and propagates failures', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } }
  let called
  globalThis.fetch = async (url, options) => {
    called = { url, options }
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) }
  }
  assert.deepEqual(await driverCancelTrip(sb, 't1', 'other', 'Emergency'), { ok: true })
  assert.match(called.url, /\/api\/driver\?action=trip-status$/)
  assert.equal(called.options.method, 'POST')
  assert.equal(called.options.headers.Authorization, 'Bearer test-token')
  assert.deepEqual(JSON.parse(called.options.body), { tripId: 't1', op: 'driver-cancel', reason: 'other', note: 'Emergency' })
  await driverCancelTrip(sb, 't1', 'vehicle_issue')
  assert.equal(Object.hasOwn(JSON.parse(called.options.body), 'note'), false)
  globalThis.fetch = async () => ({ ok: false, status: 409, text: async () => JSON.stringify({ error: 'Use the backup queue', code: 'scheduled_use_backup' }) })
  await assert.rejects(driverCancelTrip(sb, 't1', 'vehicle_issue'), { status: 409 })
})
