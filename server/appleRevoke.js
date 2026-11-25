/**
 * Revoke a Sign in with Apple token when an account is deleted.
 * https://appleid.apple.com/auth/revoke
 *
 * The call runs only when the server has a client secret. Either set
 * APPLE_CLIENT_SECRET (already generated) or the key material:
 * APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (.p8 PEM), and
 * APPLE_CLIENT_ID or APPLE_CLIENT_IDS. APPLE_SERVICE_ID is accepted as
 * an alias of APPLE_CLIENT_ID. When the key is set and no client id is,
 * the rider and driver bundle ids are used.
 * Missing configuration logs a warning and does not block deletion.
 */
import { createPrivateKey, createSign } from 'node:crypto'

export const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke'

export const APPLE_NOT_CONFIGURED_WARNING =
  '[apple-revoke] Apple account revocation is not configured. Set APPLE_TEAM_ID, APPLE_KEY_ID, and APPLE_PRIVATE_KEY, plus APPLE_CLIENT_ID or APPLE_CLIENT_IDS. APPLE_CLIENT_SECRET can stand in for the key when a secret is already generated.'

export const APPLE_TOKEN_MISSING_WARNING =
  '[apple-revoke] This account signed in with Apple, but no Apple refresh token is stored. Revocation was skipped.'

const RIDER_BUNDLE_ID = 'com.ascendmaui.clemsonrides.rider'
const DRIVER_BUNDLE_ID = 'com.ascendmaui.clemsonrides.driver'
const MAX_SECRET_SECONDS = 15777000

function trimmed(value) {
  return String(value || '').trim()
}

function b64url(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value))
  return buf.toString('base64url')
}

function clientIdFromSecret(secret) {
  const part = String(secret || '').split('.')[1]
  if (!part) return ''
  try {
    const json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return trimmed(json?.sub)
  } catch {
    return ''
  }
}

function pushId(ids, value) {
  const id = trimmed(value)
  if (id && !ids.includes(id)) ids.push(id)
}

export function appleRevokeConfig(env = process.env) {
  const teamId = trimmed(env?.APPLE_TEAM_ID)
  const keyId = trimmed(env?.APPLE_KEY_ID)
  const privateKey = trimmed(env?.APPLE_PRIVATE_KEY).replace(/\\n/g, '\n')
  const presetSecret = trimmed(env?.APPLE_CLIENT_SECRET)
  const clientIds = []
  pushId(clientIds, env?.APPLE_CLIENT_ID)
  pushId(clientIds, env?.APPLE_SERVICE_ID)
  for (const piece of trimmed(env?.APPLE_CLIENT_IDS).split(',')) pushId(clientIds, piece)
  const hasKey = Boolean(teamId && keyId && privateKey)
  if (!clientIds.length && presetSecret) pushId(clientIds, clientIdFromSecret(presetSecret))
  if (!clientIds.length && hasKey) {
    pushId(clientIds, RIDER_BUNDLE_ID)
    pushId(clientIds, DRIVER_BUNDLE_ID)
  }
  return {
    teamId,
    keyId,
    privateKey,
    presetSecret,
    clientIds,
    configured: Boolean(clientIds.length && (hasKey || presetSecret)),
  }
}

/** DER ECDSA signature to the raw R||S form Apple's ES256 client secret uses. */
export function derToJose(der, size = 32) {
  const buf = Buffer.isBuffer(der) ? der : Buffer.from(der)
  if (buf[0] !== 0x30) throw new Error('Invalid DER signature')
  let offset = 2
  if (buf[1] & 0x80) offset = 2 + (buf[1] & 0x7f)
  if (buf[offset] !== 0x02) throw new Error('Invalid DER signature')
  const rLen = buf[offset + 1]
  let r = buf.subarray(offset + 2, offset + 2 + rLen)
  offset += 2 + rLen
  if (buf[offset] !== 0x02) throw new Error('Invalid DER signature')
  const sLen = buf[offset + 1]
  let s = buf.subarray(offset + 2, offset + 2 + sLen)
  if (r[0] === 0x00) r = r.subarray(1)
  if (s[0] === 0x00) s = s.subarray(1)
  if (r.length > size || s.length > size) throw new Error('Invalid DER signature')
  const jose = Buffer.alloc(size * 2)
  jose.set(r, size - r.length)
  jose.set(s, size * 2 - s.length)
  return jose
}

export function appleClientSecret({ teamId, keyId, clientId, privateKey, now = Math.floor(Date.now() / 1000) } = {}) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss: teamId,
    iat: now,
    exp: now + MAX_SECRET_SECONDS,
    aud: 'https://appleid.apple.com',
    sub: clientId,
  }))
  const signingInput = `${header}.${payload}`
  const key = createPrivateKey(privateKey)
  const der = createSign('SHA256').update(signingInput).sign(key)
  return `${signingInput}.${b64url(derToJose(der))}`
}

export function isAppleUser(user) {
  const providers = []
  if (user?.app_metadata?.provider) providers.push(user.app_metadata.provider)
  if (Array.isArray(user?.app_metadata?.providers)) providers.push(...user.app_metadata.providers)
  if (Array.isArray(user?.identities)) {
    for (const identity of user.identities) providers.push(identity?.provider)
  }
  return providers.some((provider) => String(provider || '').toLowerCase() === 'apple')
}

export function appleToken(user) {
  const identities = Array.isArray(user?.identities) ? user.identities : []
  for (const identity of identities) {
    if (String(identity?.provider || '').toLowerCase() !== 'apple') continue
    const data = identity.identity_data || identity.identityData || {}
    const refresh = data.refresh_token || data.provider_refresh_token || identity.refresh_token || null
    if (refresh) return { token: String(refresh), hint: 'refresh_token' }
    const access = data.access_token || identity.access_token || null
    if (access) return { token: String(access), hint: 'access_token' }
  }
  return null
}

function secretFor(config, clientId, now) {
  if (config.teamId && config.keyId && config.privateKey) {
    return appleClientSecret({
      teamId: config.teamId,
      keyId: config.keyId,
      clientId,
      privateKey: config.privateKey,
      now,
    })
  }
  return config.presetSecret
}

/**
 * Best-effort Apple revocation. Never throws.
 * @returns {Promise<{ revoked: boolean, skipped?: boolean, reason?: string }>}
 */
export async function revokeAppleToken(user, { env = process.env, fetch: fetchImpl = globalThis.fetch, now = Math.floor(Date.now() / 1000), warn = console.warn } = {}) {
  if (!isAppleUser(user)) return { revoked: false, skipped: true, reason: 'not_apple' }
  const config = appleRevokeConfig(env)
  if (!config.configured) {
    warn(APPLE_NOT_CONFIGURED_WARNING)
    return { revoked: false, skipped: true, reason: 'apple_not_configured' }
  }
  const stored = appleToken(user)
  if (!stored?.token) {
    warn(APPLE_TOKEN_MISSING_WARNING)
    return { revoked: false, skipped: true, reason: 'apple_token_missing' }
  }
  let lastStatus = 0
  for (const clientId of config.clientIds) {
    let clientSecret = ''
    try {
      clientSecret = secretFor(config, clientId, now)
    } catch (error) {
      warn(`[apple-revoke] Could not build an Apple client secret: ${error?.message || 'invalid key'}`)
      return { revoked: false, skipped: true, reason: 'apple_secret_invalid' }
    }
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      token: stored.token,
      token_type_hint: stored.hint,
    })
    try {
      const response = await fetchImpl(APPLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      lastStatus = response?.status || 0
      if (response?.ok || lastStatus === 400) return { revoked: true, clientId }
    } catch (error) {
      warn(`[apple-revoke] Apple revocation request failed: ${error?.message || 'network'}`)
      return { revoked: false, skipped: true, reason: 'apple_request_failed' }
    }
  }
  warn(`[apple-revoke] Apple rejected token revocation (${lastStatus || 'no response'}). Account deletion continues.`)
  return { revoked: false, skipped: true, reason: 'apple_rejected', status: lastStatus }
}
