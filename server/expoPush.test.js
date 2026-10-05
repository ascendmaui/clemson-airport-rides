import assert from 'node:assert/strict'
import test from 'node:test'
import { EXPO_PUSH_URL, PUSH_CREDENTIAL_GAP, sendExpoPush } from './expoPush.js'

test('missing Expo credentials skip the network and name the APNs gap', async () => {
  let called = 0
  const result = await sendExpoPush({
    to: 'ExponentPushToken[abc]',
    title: 'New ride request',
    body: 'Tillman → GSP',
    data: { tripId: 'trip-1' },
  }, {
    env: {},
    fetch: async () => {
      called += 1
      return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) }
    },
  })
  assert.equal(called, 0)
  assert.equal(result.sent, false)
  assert.equal(result.reason, 'expo_credentials_missing')
  assert.match(result.gap, /APNs/)
  assert.equal(result.gap, PUSH_CREDENTIAL_GAP)
  assert.equal(JSON.stringify(result).includes('ExponentPushToken'), false)
})

test('a configured access token posts a high-priority ride alert', async () => {
  let seen = null
  const result = await sendExpoPush({
    to: 'ExponentPushToken[abc]',
    title: 'New ride request',
    body: 'Tillman → GSP',
    data: { tripId: 'trip-1', tier: 'comfort' },
    sound: 'default',
  }, {
    env: { EXPO_ACCESS_TOKEN: 'expo-secret' },
    fetch: async (url, init) => {
      seen = { url, init }
      return { ok: true, status: 200, json: async () => ({ data: [{ status: 'ok', id: 'ticket' }] }) }
    },
  })
  assert.equal(result.sent, true)
  assert.equal(result.reason, 'sent')
  assert.equal(seen.url, EXPO_PUSH_URL)
  assert.match(seen.init.headers.Authorization, /^Bearer expo-secret$/)
  const body = JSON.parse(seen.init.body)
  assert.equal(body.to, 'ExponentPushToken[abc]')
  assert.equal(body.priority, 'high')
  assert.equal(body.channelId, 'ride-requests')
  assert.equal(body.data.tripId, 'trip-1')
  assert.equal(JSON.stringify(result).includes('ExponentPushToken'), false)
  assert.equal(JSON.stringify(result).includes('expo-secret'), false)
})

test('silent ride-alert prefs omit the push sound', async () => {
  let body = null
  await sendExpoPush({
    to: 'ExponentPushToken[abc]',
    title: 'New ride request',
    body: 'Library → Stadium',
    sound: null,
  }, {
    env: { EXPO_ACCESS_TOKEN: 'expo-secret' },
    fetch: async (_url, init) => {
      body = JSON.parse(init.body)
      return { ok: true, status: 200, json: async () => ({ data: [{ status: 'ok' }] }) }
    },
  })
  assert.equal(body.sound, undefined)
})
