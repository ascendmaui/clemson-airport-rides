/**
 * Decides when the driver app hands off to the driver's nav app on its own.
 * Pickup: right after accept (on-demand, or a scheduled pickup that is close).
 * Drop-off: once the trip is started.
 * Each leg opens at most once per trip; callers persist the launched legs.
 */

export const AUTO_NAV_ACCEPT_WINDOW_MS = 10 * 60 * 1000
export const AUTO_NAV_SCHEDULED_LEAD_MS = 30 * 60 * 1000

const PICKUP_STATUSES = new Set(['accepted', 'arriving'])

function ms(value) {
  if (!value) return null
  const t = Date.parse(String(value))
  return Number.isFinite(t) ? t : null
}

/**
 * @param {object} input
 * @param {string|null|undefined} input.status
 * @param {boolean} [input.enabled]
 * @param {string[]} [input.launched] legs already opened for this trip
 * @param {string|null} [input.acceptedAt]
 * @param {string|null} [input.pickupAt]
 * @param {number} [input.now]
 * @returns {'pickup'|'dropoff'|null}
 */
export function autoNavigationLeg({ status, enabled = true, launched = [], acceptedAt = null, pickupAt = null, now = Date.now() } = {}) {
  if (!enabled) return null
  const done = new Set(Array.isArray(launched) ? launched : [])
  if (status === 'in_progress') return done.has('dropoff') ? null : 'dropoff'
  if (!PICKUP_STATUSES.has(status) || done.has('pickup')) return null
  const accepted = ms(acceptedAt)
  // A relaunch long after accept (or a scheduled ride accepted days ago) does not reopen maps.
  if (accepted == null || now - accepted > AUTO_NAV_ACCEPT_WINDOW_MS) return null
  const pickup = ms(pickupAt)
  if (pickup != null && pickup - now > AUTO_NAV_SCHEDULED_LEAD_MS) return null
  return 'pickup'
}

const STOP_LEG = /^stop:\d{1,2}$/
function isLeg(leg) {
  return leg === 'pickup' || leg === 'dropoff' || (typeof leg === 'string' && STOP_LEG.test(leg))
}

/**
 * Carpool stop list, trip started: each next stop opens the nav app once.
 * @returns {string|null} 'stop:<index>' or null
 */
export function autoNavigationStopLeg({ enabled = true, launched = [], stopIndex = null } = {}) {
  if (!enabled || !Number.isInteger(stopIndex) || stopIndex < 0) return null
  const leg = `stop:${stopIndex}`
  return (Array.isArray(launched) ? launched : []).includes(leg) ? null : leg
}

export function autoNavigationKey(tripId) {
  return `driver.auto-nav.${tripId}`
}

/** Parse the stored launched-legs list. Bad storage counts as nothing launched. */
export function readLaunchedLegs(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isLeg) : []
  } catch {
    return []
  }
}

export function withLaunchedLeg(legs, leg) {
  const list = readLaunchedLegs(JSON.stringify(legs || []))
  return list.includes(leg) ? list : [...list, leg]
}
