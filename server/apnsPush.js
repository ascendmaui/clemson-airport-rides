/**
 * Direct APNs HTTP/2 alerts for the driver app.
 * Token auth (ES256) from APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_P8, APNS_TOPIC, APNS_ENV.
 * Stays off unless those are set and DRIVER_OFFER_ALERT_PUSH=send.
 * Does not call Expo's push service.
 */
import crypto from 'node:crypto'
import http2 from 'node:http2'

const DEVICE_TOKEN = /^[0-9a-f]{64}$/i

export function isApnsDeviceToken(value) {
  return DEVICE_TOKEN.test(String(value || '').trim())
}

export function apnsHost(apnsEnv) {
  switch (String(apnsEnv || '').trim()) {
    case 'production':
      return 'api.push.apple.com'
    case 'sandbox':
      return 'api.sandbox.push.apple.com'
    default:
      return null
  }
}

function pemFromEnv(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  return text.includes('\\n') ? text.replace(/\\n/g, '\n') : text
}

export function apnsConfigFromEnv(env = process.env) {
  const keyId = String(env.APNS_KEY_ID || '').trim()
  const teamId = String(env.APNS_TEAM_ID || '').trim()
  const keyP8 = pemFromEnv(env.APNS_KEY_P8)
  const topic = String(env.APNS_TOPIC || '').trim()
  const apnsEnv = String(env.APNS_ENV || '').trim()
  const flag = String(env.DRIVER_OFFER_ALERT_PUSH || '').trim()
  const host = apnsHost(apnsEnv)
  const enabled = flag === 'send' && Boolean(keyId && teamId && keyP8 && topic && host)
  return { enabled, keyId, teamId, keyP8, topic, apnsEnv, host }
}

function b64url(value) {
  return Buffer.from(value).toString('base64url')
}

export function signApnsJwt({ keyId, teamId, keyP8, now = new Date() }) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }))
  const payload = b64url(JSON.stringify({
    iss: teamId,
    iat: Math.floor(now.getTime() / 1000),
  }))
  const unsigned = `${header}.${payload}`
  const key = crypto.createPrivateKey(keyP8)
  const signature = crypto.sign('SHA256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' })
  return `${unsigned}.${signature.toString('base64url')}`
}

function defaultTransport({ host, token, jwt, topic, body }) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const client = http2.connect(`https://${host}`)
    const close = () => {
      client.close()
    }
    client.on('error', () => {
      close()
      finish({ status: 0, error: 'apns_unreachable' })
    })
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': topic,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    })
    let status = 0
    req.setEncoding('utf8')
    req.on('response', (headers) => {
      status = Number(headers[':status'] || 0)
    })
    req.on('error', () => {
      close()
      finish({ status: 0, error: 'apns_unreachable' })
    })
    req.on('end', () => {
      close()
      finish({ status, error: null })
    })
    req.end(body)
  })
}

/**
 * @param {{ token: string, title: string, body: string, tripId?: string }} input
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(request: object) => Promise<{ status: number, error?: string | null }>} [transport]
 */
export async function sendApnsAlert(input, env = process.env, transport = defaultTransport) {
  const config = apnsConfigFromEnv(env)
  if (!config.enabled) return { sent: false, reason: 'push_sender_missing' }
  const token = String(input?.token || '').trim()
  if (!isApnsDeviceToken(token)) return { sent: false, reason: 'apns_device_token_missing' }
  let jwt = ''
  try {
    jwt = signApnsJwt(config)
  } catch {
    return { sent: false, reason: 'apns_key_invalid' }
  }
  const payload = JSON.stringify({
    aps: {
      alert: {
        title: String(input.title || 'New ride request'),
        body: String(input.body || ''),
      },
      sound: 'request.wav',
    },
    ...(input.tripId ? { tripId: String(input.tripId) } : {}),
  })
  try {
    const response = await transport({
      host: config.host,
      token,
      jwt,
      topic: config.topic,
      body: payload,
    })
    if (response?.error) return { sent: false, reason: 'apns_unreachable' }
    if (response?.status === 200) return { sent: true, reason: null }
    return { sent: false, reason: 'apns_rejected' }
  } catch {
    return { sent: false, reason: 'apns_unreachable' }
  }
}
