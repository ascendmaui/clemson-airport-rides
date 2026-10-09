/**
 * Expo push for driver offers.
 * Delivery to a locked or signed-out phone is an OS toast. That path needs
 * APNs (iOS) and FCM (Android) credentials on the Expo project. Those
 * Apple/Google keys are not in this repo. EXPO_ACCESS_TOKEN is optional
 * while Enhanced Security for Push is off. When it is set, the request
 * includes Authorization: Bearer. Set the token before enabling Enhanced
 * Security, or Expo will reject the send.
 */

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export const PUSH_CREDENTIAL_GAP =
  'Lock-screen and signed-out alerts need an APNs key on the Expo project for iOS and FCM credentials there for Android. This server cannot see those Apple or Google keys, so a successful token save does not prove a locked phone will toast. EXPO_ACCESS_TOKEN is optional while Enhanced Security for Push is off, and a missing token does not block the send. Set EXPO_ACCESS_TOKEN if Enhanced Security is later enabled.'

function expoAccessToken(env = process.env) {
  return String(env?.EXPO_ACCESS_TOKEN || '').trim()
}

export function pushCredentialStatus(env = process.env) {
  return {
    expoAccessToken: Boolean(expoAccessToken(env)),
    apnsConfiguredHere: false,
    fcmConfiguredHere: false,
    note: PUSH_CREDENTIAL_GAP,
  }
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180)
}

export async function sendExpoPush({ to, title, body, data, sound = 'default', channelId = 'ride-requests' } = {}, deps = {}) {
  const token = String(to || '').trim()
  if (!token) return { sent: false, reason: 'push_token_missing' }
  if (!/^Expo(nent)?PushToken\[/.test(token)) return { sent: false, reason: 'raw_device_token_unsupported' }
  const env = deps.env || process.env
  const creds = pushCredentialStatus(env)
  const fetchImpl = deps.fetch || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return { sent: false, reason: 'expo_push_failed', detail: 'fetch_unavailable', gap: creds.note }
  }
  const accessToken = expoAccessToken(env)
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const message = {
    to: token,
    title: clean(title) || 'New ride request',
    body: clean(body) || 'Open Clemson RIDES to respond.',
    priority: 'high',
    channelId,
    data: data && typeof data === 'object' ? data : {},
  }
  if (sound) message.sound = sound
  let response
  try {
    response = await fetchImpl(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
    })
  } catch (error) {
    return { sent: false, reason: 'expo_push_failed', detail: clean(error?.message || error) }
  }
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const ticket = Array.isArray(payload?.data) ? payload.data[0] : payload?.data
  if (!response.ok || ticket?.status === 'error') {
    const detail = ticket?.details?.error || ticket?.message || `http_${response.status}`
    const reason = /credentials|invalidcredentials/i.test(String(detail))
      ? 'expo_credentials_missing'
      : detail === 'DeviceNotRegistered' ? 'device_not_registered' : 'expo_push_rejected'
    return { sent: false, reason, detail: clean(detail), gap: creds.note }
  }
  return { sent: true, reason: 'sent' }
}
