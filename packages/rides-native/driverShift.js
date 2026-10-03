/**
 * Driver availability: Start rides is online and not off the clock.
 * Stop rides is offline and off the clock (quiet.dnd).
 * Scheduled quiet hours are a separate switch and do not change this shift.
 */

const ON_WORDS = new Set(['true', 'yes', 'on', '1'])

/** True only for real on values. "false", "no", "off", and "0" are off. */
export function quietSwitchOn(value) {
  if (value === true || value === 1) return true
  if (typeof value === 'string') return ON_WORDS.has(value.trim().toLowerCase())
  return false
}

/** The pair written together when the driver starts or stops rides. */
export function desiredShift(available) {
  const on = Boolean(available)
  return { available: on, online: on, dnd: !on }
}

/**
 * Read the shift from driver_status.online and quiet.dnd.
 * Off the clock wins: a stored dnd flag means unavailable even if online is still true.
 * reconcile is true when online must be cleared so a later location write cannot stick them on.
 */
export function readShift({ online, dnd } = {}) {
  const dndOn = quietSwitchOn(dnd)
  const onlineOn = quietSwitchOn(online)
  if (dndOn) return { available: false, dnd: true, reconcile: onlineOn }
  return { available: onlineOn, dnd: false, reconcile: false }
}

/** Map ripple runs while they are on the clock and not already on a trip. */
export function lookingForRides({ available, onTrip = false } = {}) {
  return Boolean(available) && !onTrip
}

/**
 * Leaving the driver home, opening another screen, or backgrounding the app
 * does not end the shift. Only Stop / End writes online false.
 */
export function onlineAfterLeave(wasOnline) {
  return Boolean(wasOnline)
}

/** Top-bar offer popup when a request arrives off the driver home or while the app is not active. */
export function showOfferInTopBar({ online, hasOffer, onDriverHome = false, appActive = true } = {}) {
  if (!online || !hasOffer) return false
  if (!appActive) return true
  return !onDriverHome
}
