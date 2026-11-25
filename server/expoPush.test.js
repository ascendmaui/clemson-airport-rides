import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EXPO_PUSH_URL,
  EXPO_RECEIPTS_URL,
  PUSH_CREDENTIAL_GAP,
  expoReceiptError,
  fetchExpoPushReceipts,
  pollExpoPushReceipts,
  pushCredentialStatus,
  receiptDropsToken,
  sendExpoPush,
} from './expoPush.js'

test('push credential status names the APNs and FCM gap without blocking on a missing access token', () => {
  const status = pushCredentialStatus({})
  assert.equal(status.expoAccessToken, false)
  assert.equal(status.apnsConfiguredHere, false)
  assert.equal(status.fcmConfiguredHere, false)
  assert.equal(status.note, PUSH_CREDENTIAL_GAP)
  assert.match(status.note, /APNs/)
  assert.match(status.note, /FCM/)
  assert.match(status.note, /Enhanced Security/)
  assert.match(status.note, /does not block the send/)
  assert.equal(/need EXPO_ACCESS_TOKEN|only when `?EXPO_ACCESS_TOKEN/i.test(status.note), false)
  assert.equal(pushCredentialStatus({ EXPO_ACCESS_TOKEN: '  expo-secret  ' }).expoAccessToken, true)
  assert.equal(pushCredentialStatus({ EXPO_ACCESS_TOKEN: '   ' }).expoAccessToken, false)
})

test('an unset or empty access token still posts without Authorization', async () => {
  const envs = [{}, { EXPO_ACCESS_TOKEN: '' }, { EXPO_ACCESS_TOKEN: '   ' }]
  for (const env of envs) {
    let seen = null
    const result = await sendExpoPush({
      to: 'ExponentPushToken[abc]',
      title: 'New ride request',
      body: 'Tillman → GSP',
      data: { tripId: 'trip-1' },
    }, {
      env,
      fetch: async (url, init) => {
        seen = { url, init }
        return { ok: true, status: 200, json: async () => ({ data: [{ status: 'ok' }] }) }
      },
    })
    assert.equal(result.sent, true)
    assert.equal(result.reason, 'sent')
    assert.equal(seen.url, EXPO_PUSH_URL)
    assert.equal(seen.init.method, 'POST')
    assert.equal(Object.hasOwn(seen.init.headers, 'Authorization'), false)
    const body = JSON.parse(seen.init.body)
    assert.equal(body.to, 'ExponentPushToken[abc]')
    assert.equal(body.priority, 'high')
    assert.equal(JSON.stringify(result).includes('ExponentPushToken'), false)
  }
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
  assert.equal(result.ticketId, 'ticket')
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

test('credential detection and device rejection have distinct reasons', async () => {
  for (const [error, reason] of [['InvalidCredentials', 'expo_credentials_missing'], ['DeviceNotRegistered', 'device_not_registered'], ['MessageTooBig', 'expo_push_rejected']]) {
    const result = await sendExpoPush({ to: 'ExpoPushToken[test]' }, {
      env: {}, fetch: async () => ({ ok: true, json: async () => ({ data: { status: 'error', details: { error } } }) }),
    })
    assert.equal(result.sent, false)
    assert.equal(result.reason, reason)
  }
})

test('shared sender rejects raw tokens before fetching', async () => {
  const result = await sendExpoPush({ to: 'a'.repeat(64) }, { fetch: async () => assert.fail('raw token sent') })
  assert.equal(result.reason, 'raw_device_token_unsupported')
})

test('receipt fetch posts ticket ids and classifies DeviceNotRegistered', async () => {
  let seen = null
  const result = await fetchExpoPushReceipts([' ticket-1 ', 'ticket-1', ''], {
    env: { EXPO_ACCESS_TOKEN: 'expo-secret' },
    fetch: async (url, init) => {
      seen = { url, init }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            'ticket-1': { status: 'error', details: { error: 'DeviceNotRegistered' } },
            'ticket-2': { status: 'ok' },
          },
        }),
      }
    },
  })
  assert.equal(result.ok, true)
  assert.equal(seen.url, EXPO_RECEIPTS_URL)
  assert.match(seen.init.headers.Authorization, /^Bearer expo-secret$/)
  assert.deepEqual(JSON.parse(seen.init.body).ids, ['ticket-1'])
  assert.equal(expoReceiptError(result.receipts['ticket-1']), 'DeviceNotRegistered')
  assert.equal(receiptDropsToken(result.receipts['ticket-1']), true)
  assert.equal(expoReceiptError(result.receipts['ticket-2']), null)
  assert.equal(receiptDropsToken(result.receipts['ticket-2']), false)
  assert.equal(expoReceiptError(undefined), null)
})

test('receipt polling stops when every ticket is present and does not wait after the last try', async () => {
  const waits = []
  let calls = 0
  const result = await pollExpoPushReceipts(['a', 'b'], {
    attempts: 3,
    waitMs: 20,
    sleep: async (ms) => { waits.push(ms) },
    fetch: async () => {
      calls += 1
      const data = calls === 1 ? { a: { status: 'ok' } } : { a: { status: 'ok' }, b: { status: 'ok' } }
      return { ok: true, status: 200, json: async () => ({ data }) }
    },
  })
  assert.equal(calls, 2)
  assert.deepEqual(waits, [20])
  assert.equal(result.attempt, 2)
  assert.deepEqual(result.pending, [])
})
