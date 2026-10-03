/** Browser Web Push for the driver web app. Riders do not call this. */

export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

export function driverPushSupported() {
  return typeof window !== 'undefined'
    && typeof Notification !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
}

/**
 * Ask for notification permission (unless it is already granted) and subscribe
 * this browser. Delivery when the tab is closed is the service worker's job.
 */
export async function enableDriverWebPush(publicKey, { prompt = true } = {}) {
  if (!driverPushSupported()) return { ok: false, reason: 'unsupported', permission: 'unsupported' }
  let permission = Notification.permission
  if (permission === 'default' && !prompt) return { ok: false, reason: 'needs_prompt', permission }
  if (permission !== 'granted' && prompt) permission = await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: 'denied', permission }
  if (!publicKey) return { ok: false, reason: 'missing_vapid_public_key', permission }
  const registration = await navigator.serviceWorker.register('/driver-push-sw.js')
  const existing = await registration.pushManager.getSubscription()
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })
  return { ok: true, permission, subscription: subscription.toJSON() }
}
