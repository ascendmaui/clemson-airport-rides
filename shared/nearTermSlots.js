/**
 * Near-term schedule (rider batch 2 item 9).
 *
 * Wait comes from available real drivers. Slots are pickup times 10 to 15
 * minutes from now that those drivers can still make. Demo map drivers are
 * not an input.
 *
 * The looking-for-driver Schedule button should open nearTermScheduleRoute()
 * and leave this module to own slots, board alerts, and the match pop-up.
 * It should not reimplement the wait algorithm.
 */

export const NEAR_TERM_MIN_MINUTES = 10
export const NEAR_TERM_MAX_MINUTES = 15
export const NEAR_TERM_QUERY = 'near'
export const NEAR_TERM_QUERY_VALUE = '1'
export const SCHEDULE_SLOTS_ACTION = 'schedule-slots'
export const MATCH_NOTICE_ACTION = 'match-notice'
export const SCHEDULE_TRIP_ACTION = 'schedule-trip'
export const SCHEDULED_BOARD_MARKER = 'scheduled-board'
export const SLOT_MATCH_TOLERANCE_MS = 90 * 1000
export const STALE_DRIVER_LOCATION_MS = 10 * 60 * 1000

const CAMPUS_MPH = 18
const METERS_PER_MILE = 1609.344

export const SCHEDULE_SLOTS_PATH = `/api/stripe-payment-methods?action=${SCHEDULE_SLOTS_ACTION}`
export const MATCH_NOTICE_PATH = `/api/stripe-payment-methods?action=${MATCH_NOTICE_ACTION}`
export const SCHEDULE_TRIP_PATH = `/api/stripe-payment-methods?action=${SCHEDULE_TRIP_ACTION}`

const SLOT_REASONS = ['no_drivers', 'no_location', 'wait_beyond_window', 'pickup_missing']

function haversineMeters(a, b) {
  const lat1 = Number(a?.lat)
  const lng1 = Number(a?.lng)
  const lat2 = Number(b?.lat)
  const lng2 = Number(b?.lng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function formatMiles(miles) {
  const n = Number(miles)
  if (!Number.isFinite(n) || n < 0) return null
  if (n < 0.1) return 'under 0.1 mi'
  return `${n.toFixed(1)} mi`
}

export function formatEasternClock(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

export function formatEasternWhen(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

/** Straight-line campus pace. A road ETA needs a billed Maps key. */
export function approachFromPoints(driver, pickup) {
  const driverLat = driver?.lat ?? driver?.latitude
  const driverLng = driver?.lng ?? driver?.longitude
  const meters = haversineMeters(
    { lat: driverLat, lng: driverLng },
    { lat: pickup?.lat, lng: pickup?.lng },
  )
  if (meters == null) return null
  const miles = meters / METERS_PER_MILE
  const etaMin = Math.max(1, Math.round((miles / CAMPUS_MPH) * 60))
  return {
    etaMin,
    distanceMi: Math.round(miles * 10) / 10,
    meters,
  }
}

export function locationIsFresh(driver, now = new Date()) {
  const stamp = driver?.locationUpdatedAt || driver?.location_updated_at || driver?.updatedAt || driver?.updated_at
  if (!stamp) return false
  const at = new Date(stamp).getTime()
  const clock = now instanceof Date ? now.getTime() : new Date(now).getTime()
  if (!Number.isFinite(at) || !Number.isFinite(clock)) return false
  return clock - at <= STALE_DRIVER_LOCATION_MS && clock >= at
}

/**
 * @param {Array<{ id?: string, lat?: number, lng?: number, available?: boolean, simulated?: boolean, locationUpdatedAt?: string, updated_at?: string }>} drivers
 */
export function currentWaitFromDrivers(drivers, pickup, now = new Date()) {
  const list = (Array.isArray(drivers) ? drivers : []).filter((driver) => (
    driver && driver.simulated !== true && driver.available !== false
  ))
  if (!list.length) {
    return { waitMinutes: null, availableDrivers: 0, nearest: null, reason: 'no_drivers' }
  }
  let best = null
  for (const driver of list) {
    if (!locationIsFresh(driver, now)) continue
    const approach = approachFromPoints(driver, pickup)
    if (!approach) continue
    if (!best || approach.etaMin < best.etaMin) {
      best = approach
    }
  }
  if (!best) {
    return { waitMinutes: null, availableDrivers: list.length, nearest: null, reason: 'no_location' }
  }
  return {
    waitMinutes: best.etaMin,
    availableDrivers: list.length,
    nearest: { etaMin: best.etaMin, distanceMi: best.distanceMi },
    reason: null,
  }
}

export function slotEmptyMessage(reason) {
  switch (reason) {
    case 'no_drivers':
      return 'No drivers available right now'
    case 'no_location':
      return 'Drivers are online, but none have a recent location for a pickup time.'
    case 'wait_beyond_window':
      return 'Current wait is longer than 15 minutes, so there is no pickup in the next 10 to 15 minutes.'
    case 'pickup_missing':
      return 'Choose a pickup to see times.'
    case null:
      return null
    default: {
      const unknown = reason
      throw new Error(`Unknown slot reason: ${String(unknown)}`)
    }
  }
}

export function offerNearTermSlots({ waitMinutes, now = new Date(), reason = null } = {}) {
  const clock = now instanceof Date ? now : new Date(now)
  if (waitMinutes == null || !Number.isFinite(Number(waitMinutes))) {
    const emptyReason = SLOT_REASONS.includes(reason) ? reason : 'no_drivers'
    return {
      waitMinutes: null,
      slots: [],
      reason: emptyReason,
      emptyMessage: slotEmptyMessage(emptyReason),
      window: { minMinutes: NEAR_TERM_MIN_MINUTES, maxMinutes: NEAR_TERM_MAX_MINUTES },
    }
  }
  const wait = Math.max(1, Math.ceil(Number(waitMinutes)))
  const slots = []
  for (let minutes = NEAR_TERM_MIN_MINUTES; minutes <= NEAR_TERM_MAX_MINUTES; minutes += 1) {
    if (minutes < wait) continue
    const pickupAt = new Date(clock.getTime() + minutes * 60 * 1000).toISOString()
    const clockLabel = formatEasternClock(pickupAt)
    slots.push({
      id: `m${minutes}`,
      minutesOut: minutes,
      pickupAt,
      label: clockLabel ? `In ${minutes} min · ${clockLabel}` : `In ${minutes} min`,
    })
  }
  const beyond = slots.length === 0
  return {
    waitMinutes: wait,
    slots,
    reason: beyond ? 'wait_beyond_window' : null,
    emptyMessage: beyond ? slotEmptyMessage('wait_beyond_window') : null,
    window: { minMinutes: NEAR_TERM_MIN_MINUTES, maxMinutes: NEAR_TERM_MAX_MINUTES },
  }
}

export function waitLabel(waitMinutes) {
  if (waitMinutes == null || !Number.isFinite(Number(waitMinutes))) return null
  const n = Math.max(1, Math.ceil(Number(waitMinutes)))
  return n === 1 ? 'About 1 min' : `About ${n} min`
}

export function matchRequestedSlot(slots, when, toleranceMs = SLOT_MATCH_TOLERANCE_MS) {
  const t = when instanceof Date ? when.getTime() : new Date(when).getTime()
  if (!Number.isFinite(t)) return null
  let best = null
  let bestDelta = Infinity
  for (const slot of slots || []) {
    const at = new Date(slot?.pickupAt).getTime()
    if (!Number.isFinite(at)) continue
    const delta = Math.abs(at - t)
    if (delta <= toleranceMs && delta < bestDelta) {
      best = slot
      bestDelta = delta
    }
  }
  return best
}

export function isNearTermRequest(body) {
  return body?.nearTerm === true || body?.scheduleWindow === 'near_term'
}

export function isNearTermTrip(trip) {
  if (!trip) return false
  if (trip.nearTerm === true) return true
  const meta = trip.metadata
  return Boolean(meta && typeof meta === 'object' && meta.near_term_slot === true)
}

export function driverFirstName(fullName, fallback = 'Your driver') {
  const raw = String(fullName || '').trim()
  if (!raw) return fallback
  const token = raw.split(/\s+/)[0] || ''
  const cleaned = (token.includes('@') ? token.split('@')[0] : token).replace(/[^a-zA-Z'-]/g, '')
  if (!cleaned) return fallback
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

export function scheduledBoardCopy(trip) {
  const pickup = String(trip?.pickup_label || trip?.pickupLabel || '').trim() || 'Pickup'
  const dropoff = String(trip?.dropoff_label || trip?.dropoffLabel || '').trim() || 'Drop-off'
  const when = formatEasternWhen(trip?.pickup_at || trip?.pickupAt || trip?.scheduled_for)
  return {
    title: 'Scheduled ride on the board',
    body: when ? `${pickup} → ${dropoff} · ${when}` : `${pickup} → ${dropoff}`,
  }
}

/**
 * Rider match pop-up. Distance is how far the driver is from pickup.
 * Pickup time is the scheduled slot, or now plus the straight-line ETA.
 */
export function buildRiderMatchNotice({
  driverName,
  distanceMi = null,
  etaMin = null,
  pickupAt = null,
  now = new Date(),
} = {}) {
  const name = driverFirstName(driverName, 'Your driver')
  const distanceLabel = formatMiles(distanceMi)
  const eta = etaMin != null && Number.isFinite(Number(etaMin)) ? Math.max(1, Math.round(Number(etaMin))) : null
  const clock = now instanceof Date ? now : new Date(now)
  const scheduled = pickupAt ? new Date(pickupAt) : null
  const when = scheduled && !Number.isNaN(scheduled.getTime())
    ? scheduled
    : (eta != null ? new Date(clock.getTime() + eta * 60 * 1000) : null)
  const pickupLabel = when ? formatEasternWhen(when.toISOString()) : null
  const far = distanceLabel
    ? `${distanceLabel} away${eta != null ? ` · about ${eta} min out` : ''}`
    : 'sharing location when they head to pickup'
  const pickup = pickupLabel ? `Pickup ${pickupLabel}` : 'Pickup time follows their ETA'
  return {
    kind: 'driver_matched',
    title: 'Driver matched',
    driverName: name,
    distanceLabel,
    etaLabel: eta != null ? `${eta} min` : null,
    pickupAt: when ? when.toISOString() : null,
    pickupLabel,
    body: `${name} is ${far}. ${pickup}.`,
  }
}

/**
 * Contract for the looking-for-driver Schedule button.
 * Native: router.push(nearTermScheduleRoute(opts).native)
 * Web: navigate(route.web.path, route.web.params)
 */
export function nearTermScheduleRoute({ pickupLabel, dropoffLabel, tier } = {}) {
  const params = { [NEAR_TERM_QUERY]: NEAR_TERM_QUERY_VALUE }
  if (pickupLabel) params.pickup = String(pickupLabel)
  if (dropoffLabel) params.dropoff = String(dropoffLabel)
  if (tier) params.tier = String(tier)
  return {
    native: { pathname: '/schedule', params },
    web: { path: 'schedule', params },
  }
}
