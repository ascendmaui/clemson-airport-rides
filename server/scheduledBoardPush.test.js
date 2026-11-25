/** Scheduled-board alerts send Expo push like live offers (server/driverOfferAlerts.js). Push is mocked. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { notifyScheduledBoard, SCHEDULED_BOARD_MARKER } from './scheduledBoardAlerts.js'
import { memorySupabase } from '../tests/fixtures/memorySupabase.js'

const NOW = new Date('2026-10-16T16:00:00Z') // noon ET, outside default quiet hours
const TRIP = {
  id: 'trip-board-1',
  rider_id: 'rider-1',
  status: 'scheduled',
  pickup_label: 'Cooper Library',
  dropoff_label: 'GSP Airport',
  pickup_at: '2026-10-16T20:00:00Z',
  metadata: { ride_option: 'standard' },
}

function fleet({ tokens = [], prefs = {} } = {}) {
  const drivers = ['d-token', 'd-none']
  return memorySupabase({
    driver_applications: drivers.map((id) => ({ profile_id: id, onboarding_status: 'approved' })),
    profiles: [
      { id: 'rider-1', email: 'rider@example.com' },
      ...drivers.map((id) => ({ id, email: `${id}@example.com`, notification_prefs: prefs[id] ?? null })),
    ],
    driver_push_tokens: tokens,
    driver_offer_alerts: [],
  })
}

function expoFetch(ticket = { status: 'ok', id: 'ticket-1' }, { ok = true, status = 200 } = {}) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers })
    return new Response(JSON.stringify({ data: ticket }), { status: ok ? 200 : status })
  }
  return { calls, fetch }
}

const alertFor = (sb, driverId) => sb.tables.driver_offer_alerts.find((row) => row.driver_id === driverId && row.offer_marker === SCHEDULED_BOARD_MARKER)

test('a driver with an Expo token gets a scheduled-board push and the alert records it as sent', async () => {
  const sb = fleet({ tokens: [{ driver_id: 'd-token', token: 'ExponentPushToken[board]', platform: 'ios' }] })
  const push = expoFetch()
  const result = await notifyScheduledBoard(sb, { trip: TRIP, riderIsE2E: false }, { fetch: push.fetch, env: {}, now: NOW })
  assert.equal(result.ok, true)
  assert.equal(result.notified, 2)
  assert.equal(result.pushesSent, 1)
  assert.equal(push.calls.length, 1)
  assert.match(push.calls[0].url, /exp\.host\/--\/api\/v2\/push\/send/)
  assert.equal(push.calls[0].body.to, 'ExponentPushToken[board]')
  assert.equal(push.calls[0].body.data.tripId, TRIP.id)
  assert.equal(push.calls[0].body.data.kind, 'scheduled_board')
  assert.equal(push.calls[0].body.title, result.title)
  assert.equal(push.calls[0].headers.Authorization, undefined, 'no Expo access token needed')
  const sent = alertFor(sb, 'd-token').channels
  assert.deepEqual({ sent: sent.push.sent, reason: sent.push.reason, tokenKind: sent.push.tokenKind }, { sent: true, reason: 'sent', tokenKind: 'expo' })
  assert.equal(sent.in_app.sent, true)
  assert.equal(sent.sms.reason, 'board_prefers_in_app')
})

test('a driver with no push token is still notified in-app and nothing is sent', async () => {
  const sb = fleet()
  const push = expoFetch()
  const result = await notifyScheduledBoard(sb, { trip: TRIP, riderIsE2E: false }, { fetch: push.fetch, env: {}, now: NOW })
  assert.equal(result.ok, true)
  assert.equal(result.notified, 2)
  assert.equal(result.pushesSent, 0)
  assert.equal(push.calls.length, 0)
  for (const id of ['d-token', 'd-none']) {
    const channels = alertFor(sb, id).channels
    assert.equal(channels.push.sent, false)
    assert.equal(channels.push.reason, 'push_token_missing')
    assert.equal(channels.in_app.sent, true)
  }
})

test('missing Expo/APNs credentials are recorded, not thrown, and the board alert still lands', async () => {
  const sb = fleet({ tokens: [{ driver_id: 'd-token', token: 'ExponentPushToken[board]', platform: 'ios' }] })
  const push = expoFetch({ status: 'error', message: 'Could not find APNs credentials', details: { error: 'InvalidCredentials' } })
  const result = await notifyScheduledBoard(sb, { trip: TRIP, riderIsE2E: false }, { fetch: push.fetch, env: {}, now: NOW })
  assert.equal(result.ok, true)
  assert.equal(result.notified, 2)
  assert.equal(result.pushesSent, 0)
  const channels = alertFor(sb, 'd-token').channels
  assert.equal(channels.push.sent, false)
  assert.equal(channels.push.reason, 'expo_credentials_missing')
  assert.match(channels.push.gap, /APNs/)
  assert.equal(channels.in_app.sent, true)
})

test('a network failure to Expo is recorded as expo_push_failed and does not break scheduling', async () => {
  const sb = fleet({ tokens: [{ driver_id: 'd-token', token: 'ExponentPushToken[board]' }] })
  const result = await notifyScheduledBoard(sb, { trip: TRIP, riderIsE2E: false }, { fetch: async () => { throw new Error('offline') }, env: {}, now: NOW })
  assert.equal(result.ok, true)
  assert.equal(alertFor(sb, 'd-token').channels.push.reason, 'expo_push_failed')
})

test('ride alerts off, quiet hours, and raw device tokens skip the push', async () => {
  const quietPrefs = { quiet: { dnd: true } }
  for (const [prefs, reasons] of [[{ ride: false }, ['ride_alerts_off']], [quietPrefs, ['quiet_hours']]]) {
    const sb = fleet({ tokens: [{ driver_id: 'd-token', token: 'ExponentPushToken[board]' }], prefs: { 'd-token': prefs } })
    const push = expoFetch()
    await notifyScheduledBoard(sb, { trip: TRIP, riderIsE2E: false }, { fetch: push.fetch, env: {}, now: NOW })
    const reason = alertFor(sb, 'd-token').channels.push.reason
    assert.ok(reasons.includes(reason), `${JSON.stringify(prefs)} → ${reason}`)
    assert.equal(push.calls.length, 0)
    assert.equal(alertFor(sb, 'd-token').channels.in_app.sent, true)
  }
  const sb = fleet({ tokens: [{ driver_id: 'd-token', token: 'raw-apns-device-token' }] })
  const push = expoFetch()
  await notifyScheduledBoard(sb, { trip: TRIP, riderIsE2E: false }, { fetch: push.fetch, env: {}, now: NOW })
  assert.equal(push.calls.length, 0)
  assert.equal(alertFor(sb, 'd-token').channels.push.reason, 'raw_device_token_unsupported')
})

test('a repeat board notify for the same trip never pushes the driver twice', async () => {
  const sb = fleet({ tokens: [{ driver_id: 'd-token', token: 'ExponentPushToken[board]' }] })
  const push = expoFetch()
  await notifyScheduledBoard(sb, { trip: TRIP, riderIsE2E: false }, { fetch: push.fetch, env: {}, now: NOW })
  const again = await notifyScheduledBoard(sb, { trip: TRIP, riderIsE2E: false }, { fetch: push.fetch, env: {}, now: NOW })
  assert.equal(again.notified, 2)
  assert.equal(push.calls.length, 1)
  assert.equal(sb.tables.driver_offer_alerts.filter((row) => row.driver_id === 'd-token').length, 1)
})
