/**
 * Expo push for driver offers.
 * Delivery to a locked or signed-out phone is an OS toast. That path needs
 * EXPO_ACCESS_TOKEN on this server and APNs (iOS) / FCM (Android) credentials
 * on the Expo project. Those Apple/Google keys are not in this repo.
 */

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export const PUSH_CREDENTIAL_GAP =
  'Lock-screen and signed-out alerts need EXPO_ACCESS_TOKEN on the server. iOS also needs an APNs key on the Expo project, and Android needs FCM credentials there. This server cannot see those Apple or Google keys, so a successful token save does not prove a locked phone will toast.'

export function pushCredentialStatus(env = process.env) {
  return {
    expoAccessToken: Boolean(String(env.EXPO_ACCESS_TOKEN || '').trim()),
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
  const creds = pushCredentialStatus(deps.env || process.env)
  if (!creds.expoAccessToken) {
    return { sent: false, reason: 'expo_credentials_missing', gap: creds.note }
  }
  const fetchImpl = deps.fetch || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return { sent: false, reason: 'expo_credentials_missing', gap: creds.note }
  }
  const accessToken = String((deps.env || process.env).EXPO_ACCESS_TOKEN).trim()
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
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
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
  const ticket = Array.isArray(payload?.data) ? payload.data[0] : null
  if (!response.ok || ticket?.status === 'error') {
    const detail = ticket?.details?.error || ticket?.message || `http_${response.status}`
    const reason = /credentials|invalidcredentials/i.test(String(detail))
      ? 'expo_credentials_missing'
      : 'expo_push_rejected'
    return { sent: false, reason, detail: clean(detail), gap: creds.note }
  }
  return { sent: true, reason: 'sent' }
}
