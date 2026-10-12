import { quietFromPrefs } from './notificationPrefs.js'
import { isQuietAt } from '../../shared/quietWindow.js'

/** Do-not-disturb, or Clemson time (America/New_York) is inside the driver's quiet window. Wraps midnight. */
export function isQuietNow(prefs, now = new Date()) {
  return isQuietAt(quietFromPrefs(prefs), now)
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
