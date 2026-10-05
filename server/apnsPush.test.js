import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { apnsConfigFromEnv, isApnsDeviceToken, sendApnsAlert, signApnsJwt } from './apnsPush.js'

const HEX = 'a'.repeat(64)

function enabledEnv(extra = {}) {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return {
    DRIVER_OFFER_ALERT_PUSH: 'send',
    APNS_KEY_ID: 'KEYID123',
    APNS_TEAM_ID: 'L85AF3V872',
    APNS_KEY_P8: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    APNS_TOPIC: 'com.ascendmaui.clemsonrides.driver',
    APNS_ENV: 'sandbox',
    ...extra,
  }
}

test('APNs stays off unless the flag and every credential are set', () => {
  assert.equal(apnsConfigFromEnv({}).enabled, false)
  assert.equal(apnsConfigFromEnv({ DRIVER_OFFER_ALERT_PUSH: 'send' }).enabled, false)
  const on = apnsConfigFromEnv(enabledEnv())
  assert.equal(on.enabled, true)
  assert.equal(on.host, 'api.sandbox.push.apple.com')
  assert.equal(apnsConfigFromEnv(enabledEnv({ APNS_ENV: 'production' })).host, 'api.push.apple.com')
  assert.equal(apnsConfigFromEnv(enabledEnv({ APNS_ENV: 'prod' })).enabled, false)
})

test('device tokens are 64 hex characters, not Expo push tokens', () => {
  assert.equal(isApnsDeviceToken(HEX), true)
  assert.equal(isApnsDeviceToken(HEX.toUpperCase()), true)
  assert.equal(isApnsDeviceToken('ExponentPushToken[abc]'), false)
  assert.equal(isApnsDeviceToken('abc'), false)
})

test('the APNs JWT is ES256 and the alert body does not carry the key', async () => {
  const env = enabledEnv()
  const jwt = signApnsJwt({
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    keyP8: env.APNS_KEY_P8,
    now: new Date('2026-10-05T00:00:00.000Z'),
  })
  const [header, payload, signature] = jwt.split('.')
  assert.equal(JSON.parse(Buffer.from(header, 'base64url').toString()).alg, 'ES256')
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url').toString()).iss, 'L85AF3V872')
  assert.equal(signature.length > 10, true)
  const publicKey = crypto.createPublicKey(crypto.createPrivateKey(env.APNS_KEY_P8))
  const ok = crypto.verify(
    'SHA256',
    Buffer.from(`${header}.${payload}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signature, 'base64url'),
  )
  assert.equal(ok, true)

  let seen = null
  const result = await sendApnsAlert({
    token: HEX,
    title: 'New ride request',
    body: 'Stadium → Tillman',
    tripId: 'trip-1',
  }, env, async (request) => {
    seen = request
    return { status: 200, error: null }
  })
  assert.equal(result.sent, true)
  assert.equal(seen.host, 'api.sandbox.push.apple.com')
  assert.equal(seen.topic, 'com.ascendmaui.clemsonrides.driver')
  assert.equal(seen.body.includes(env.APNS_KEY_P8.slice(0, 20)), false)
  assert.equal(seen.token, HEX)
})

test('sendApnsAlert does not call the transport when disabled or the token is not a device token', async () => {
  let calls = 0
  const transport = async () => {
    calls += 1
    return { status: 200 }
  }
  const off = await sendApnsAlert({ token: HEX, title: 't', body: 'b' }, {}, transport)
  assert.equal(off.reason, 'push_sender_missing')
  const expo = await sendApnsAlert({ token: 'ExponentPushToken[abc]', title: 't', body: 'b' }, enabledEnv(), transport)
  assert.equal(expo.reason, 'apns_device_token_missing')
  assert.equal(calls, 0)
})
