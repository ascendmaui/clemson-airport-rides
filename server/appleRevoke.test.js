import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import {
  APPLE_NOT_CONFIGURED_WARNING,
  APPLE_REVOKE_URL,
  APPLE_TOKEN_MISSING_WARNING,
  appleClientSecret,
  appleRevokeConfig,
  revokeAppleToken,
} from './appleRevoke.js'

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' })

function appleUser(token) {
  return {
    id: 'user-1',
    app_metadata: { provider: 'apple', providers: ['apple'] },
    identities: [{
      provider: 'apple',
      identity_data: token ? { refresh_token: token } : {},
    }],
  }
}

test('Apple revocation stays unwired until the key or client secret is set', () => {
  const empty = appleRevokeConfig({})
  assert.equal(empty.configured, false)
  const secretOnly = appleRevokeConfig({ APPLE_CLIENT_SECRET: 'header.payload.sig', APPLE_CLIENT_ID: 'com.ascendmaui.clemsonrides.rider' })
  assert.equal(secretOnly.configured, true)
  assert.deepEqual(secretOnly.clientIds, ['com.ascendmaui.clemsonrides.rider'])
})

test('the client secret is an ES256 JWT for the Apple client id', () => {
  const now = 1_700_000_000
  const secret = appleClientSecret({
    teamId: 'TEAMID123',
    keyId: 'KEYID12345',
    clientId: 'com.ascendmaui.clemsonrides.rider',
    privateKey: PEM,
    now,
  })
  const [header, payload, signature] = secret.split('.')
  assert.equal(JSON.parse(Buffer.from(header, 'base64url').toString()).alg, 'ES256')
  assert.equal(JSON.parse(Buffer.from(header, 'base64url').toString()).kid, 'KEYID12345')
  const body = JSON.parse(Buffer.from(payload, 'base64url').toString())
  assert.equal(body.iss, 'TEAMID123')
  assert.equal(body.sub, 'com.ascendmaui.clemsonrides.rider')
  assert.equal(body.aud, 'https://appleid.apple.com')
  assert.equal(body.iat, now)
  assert.ok(signature.length > 20)
})

test('a stored Apple refresh token is posted to Apple revoke', async () => {
  const calls = []
  const result = await revokeAppleToken(appleUser('refresh-token'), {
    env: {
      APPLE_TEAM_ID: 'TEAMID123',
      APPLE_KEY_ID: 'KEYID12345',
      APPLE_PRIVATE_KEY: PEM,
      APPLE_CLIENT_ID: 'com.ascendmaui.clemsonrides.rider',
    },
    now: 1_700_000_000,
    fetch: async (url, init) => {
      calls.push({ url, body: init.body })
      return { ok: true, status: 200 }
    },
  })
  assert.equal(result.revoked, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, APPLE_REVOKE_URL)
  const params = new URLSearchParams(calls[0].body)
  assert.equal(params.get('client_id'), 'com.ascendmaui.clemsonrides.rider')
  assert.equal(params.get('token'), 'refresh-token')
  assert.equal(params.get('token_type_hint'), 'refresh_token')
  assert.ok(params.get('client_secret').split('.').length === 3)
})

test('Apple 400 is treated as already revoked', async () => {
  const result = await revokeAppleToken(appleUser('refresh-token'), {
    env: { APPLE_CLIENT_SECRET: 'preset-secret', APPLE_CLIENT_ID: 'com.ascendmaui.clemsonrides.driver' },
    fetch: async () => ({ ok: false, status: 400 }),
  })
  assert.equal(result.revoked, true)
})

test('missing Apple configuration or a missing token warns and does not throw', async () => {
  const warnings = []
  const warn = (message) => warnings.push(message)
  const missingKey = await revokeAppleToken(appleUser('refresh-token'), { env: {}, warn })
  assert.equal(missingKey.reason, 'apple_not_configured')
  assert.equal(warnings[0], APPLE_NOT_CONFIGURED_WARNING)
  const missingToken = await revokeAppleToken(appleUser(null), {
    env: { APPLE_CLIENT_SECRET: 'preset', APPLE_CLIENT_ID: 'com.ascendmaui.clemsonrides.rider' },
    warn,
  })
  assert.equal(missingToken.reason, 'apple_token_missing')
  assert.equal(warnings[1], APPLE_TOKEN_MISSING_WARNING)
  const emailUser = await revokeAppleToken({ id: 'e', app_metadata: { provider: 'email' } }, { env: {}, warn })
  assert.equal(emailUser.reason, 'not_apple')
  assert.equal(warnings.length, 2)
})
