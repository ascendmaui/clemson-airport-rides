import { quietFromPrefs } from './notificationPrefs.js'

function toMinutes(value) {
  const [h, m] = String(value).split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0
}

/** Do-not-disturb switch, or the local clock is inside the quiet window (wraps overnight). */
export function isQuietNow(prefs, now = new Date()) {
  const q = quietFromPrefs(prefs)
  if (q.dnd) return true
  if (!q.scheduleEnabled) return false
  const mins = now.getHours() * 60 + now.getMinutes()
  const start = toMinutes(q.start)
  const end = toMinutes(q.end)
  if (start === end) return true
  if (start < end) return mins >= start && mins < end
  return mins >= start || mins < end
}

/**
 * Whether a new ride offer may buzz, chime, or post a local notification.
 * Offline drivers never get one. Ride alerts off or quiet hours silence it.
 */
export function newRideAlertAllowed({ online, prefs, now = new Date() }) {
  if (!online) return false
  if (prefs && prefs.ride === false) return false
  if (isQuietNow(prefs, now)) return false
  return true
}
