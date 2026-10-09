/**
 * Website driver shift. On shift, the driver can receive offers.
 * Off the clock, they cannot. Stopping writes presence only.
 */

export function isOnShift(status) {
  return Boolean(status && status.online === true)
}

export function canReceiveOffers({ onShift, approved }) {
  return Boolean(onShift && approved)
}

export function startShift() {
  return {
    presence: { online: true },
    cancelsTrip: false,
  }
}

/**
 * The trip argument is returned as the same object. Nothing on it is patched,
 * and the presence write has no trip status, fare, or cancel field.
 */
export function stopShift({ trip = null } = {}) {
  return {
    presence: { online: false },
    trip,
    cancelsTrip: false,
  }
}

export function visibleOffer({ onShift, offer, activeTrip }) {
  if (!onShift || activeTrip) return null
  return offer || null
}

/** GPS writes coordinates. The shift flag is not part of a location tick. */
export function locationFields({ lat, lng, heading = null, online } = {}) {
  const fields = { lat, lng, heading }
  if (typeof online === 'boolean') fields.online = online
  return fields
}
