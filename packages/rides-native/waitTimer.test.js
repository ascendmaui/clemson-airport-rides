import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { waitTimerAnchor, waitTimerView } from './waitTimer.js'
import { advanceTrip, tripWaitTick } from './driverDesk.js'
import { tripPayoutCents, weekNetCents, toDriverCard } from './tripTags.js'

const arrivedAt = '2026-10-09T16:00:00Z'
const start = Date.parse(arrivedAt)
for (const [seconds, fee, canCancel, autoDue, rider, driver] of [
  [0, 0, false, false, 0, 0], [179, 0, false, false, 0, 0],
  [180, 0, false, false, 0, 0], [181, 100, false, false, 100, 80],
  [299, 200, false, false, 200, 160], [300, 200, true, false, 200, 160],
  [419, 400, true, false, 400, 320], [420, 400, false, true, 500, 400],
]) {
  test(`wait timer at ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, () => {
    const view = waitTimerView(arrivedAt, start + seconds * 1000)
    assert.equal(view.waitFeeCents, fee)
    assert.equal(view.cancelAvailable, canCancel)
    assert.equal(view.autoDue, autoDue)
    assert.equal(view.riderChargeCents, rider)
    assert.equal(view.driverEarningsCents, driver)
    assert.equal(view.feeLabel, fee ? `$${(fee / 100).toFixed(2)} wait fee` : 'Free wait')
    assert.match(view.accessibilityLabel, new RegExp(view.clock))
  })
}
test('server clock corrects a fast device and advances locally between ticks', () => {
  const deviceNow = start + 3600000
  const anchor = waitTimerAnchor(arrivedAt, new Date(start + 299000).toISOString(), deviceNow)
  assert.equal(waitTimerView(arrivedAt, deviceNow, anchor).countdown, '0:01')
  assert.equal(waitTimerView(arrivedAt, deviceNow + 1000, anchor).cancelAvailable, true)
  assert.equal(waitTimerView(arrivedAt, deviceNow + 121000, anchor).clock, '7:00')
  assert.equal(waitTimerAnchor(arrivedAt, 'bad-date'), null)
  assert.equal(waitTimerView(null).cancelAvailable, false)
})
test('wait tick posts to the authenticated wait endpoint; late Start returns no-show', async (t) => {
  const calls = []
  const trip = { id: 'trip', status: 'cancelled_wait', wait_fee_cents: 400, cancel_fee_cents: 100, driver_wait_earnings_cents: 400 }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) })
    return { ok: true, status: 200, json: async () => ({ trip, serverNow: arrivedAt }) }
  })
  const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } }
  await tripWaitTick(sb, 'trip')
  assert.match(calls[0].url, /\/api\/driver\?action=wait$/)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].headers.Authorization, 'Bearer test-token')
  assert.deepEqual(calls[0].body, { action: 'tick', tripId: 'trip' })
  assert.equal((await advanceTrip(sb, { id: 'trip', status: 'arrived' }, 'driver')).status, 'cancelled_wait')
})
test('no-show earnings ignore the booked fare and boost, using the cancellation date', () => {
  const trip = { id: 'wait', status: 'cancelled_wait', fare_cents: 9000, boost_cents: 1000,
    canceled_at: arrivedAt, wait_fee_cents: 400, cancel_fee_cents: 100, driver_wait_earnings_cents: 400,
    metadata: { driver_payout_cents: 7200 } }
  assert.equal(tripPayoutCents(trip), 400)
  assert.equal(weekNetCents([trip], new Date(arrivedAt)), 400)
  const card = toDriverCard(trip)
  assert.equal(card.driverNetCents, 400)
  assert.equal(card.waitFeeCents + card.cancelFeeCents, 500)
})
test('native arrived timer, cancel confirmation and terminal no-show result are rendered', () => {
  const trip = readFileSync(new URL('../../apps/driver/app/trip.tsx', import.meta.url), 'utf8')
  const timer = readFileSync(new URL('../../apps/driver/components/WaitTimer.tsx', import.meta.url), 'utf8')
  assert.match(trip, /trip.status === 'arrived' \? <WaitTimer/)
  assert.match(trip, /tripWaitTick\(supabase, tripId\)/)
  assert.match(trip, /setInterval\(\(\) => void tick\(\), 10000\)/)
  assert.match(trip, /driverTripAction\(supabase, trip.id, 'cancel'\)/)
  assert.match(trip, /result\?\.status === 'cancelled_wait'[\s\S]*?setTrip\(toDriverCard\(result/)
  assert.match(trip, /trip.status === 'cancelled_wait'[\s\S]*?Rider no-show[\s\S]*?trip.waitFeeCents \+ trip.cancelFeeCents[\s\S]*?You earn[\s\S]*?trip.driverWaitEarningsCents/)
  assert.match(trip, /label="Back to Home"/)
  assert.match(timer, /Alert.alert\('Rider no-show'[\s\S]*?riderChargeCents[\s\S]*?driverEarningsCents/)
  assert.match(timer, /accessibilityLabel=\{view.accessibilityLabel\}/)
  assert.match(timer, /disabled=\{busy \|\| !view.cancelAvailable\}/)
})
