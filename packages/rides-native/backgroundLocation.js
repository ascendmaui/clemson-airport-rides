import { isLiveLocationStatus } from './liveFix.js'

export const LOCATION_PUBLISH_MIN_INTERVAL_MS = 4000

/** Republish the last fix on a clock during an active trip, even when the car is still. */
export const TRIP_LOCATION_HEARTBEAT_MS = 12000

export function createTripLocationHeartbeat({
  publish,
  active,
  intervalMs = TRIP_LOCATION_HEARTBEAT_MS,
} = {}) {
  let timer = null
  let lastFix = null
  return {
    remember(fix) {
      if (!fix || !Number.isFinite(Number(fix.lat)) || !Number.isFinite(Number(fix.lng))) return
      lastFix = {
        lat: Number(fix.lat),
        lng: Number(fix.lng),
        heading: fix.heading ?? null,
        speed: fix.speed ?? null,
      }
    },
    lastFix() { return lastFix },
    start() {
      this.stop()
      if (typeof setInterval !== 'function') return
      timer = setInterval(() => { void this.beat() }, intervalMs)
      if (typeof timer.unref === 'function') timer.unref()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    async beat() {
      if (!lastFix) return false
      if (typeof active === 'function' && !await active()) return false
      if (typeof publish === 'function') await publish(lastFix)
      return true
    },
  }
}

export function isActiveTripLocationStatus(status) {
  return isLiveLocationStatus(status)
}

/** Batches may arrive out of order. Never publish an invalid coordinate as fresh. */
export function newestTripLocation(locations) {
  let newest = null
  for (const location of locations || []) {
    if (!location || !Number.isFinite(location.timestamp)
      || !Number.isFinite(location.coords?.latitude) || !Number.isFinite(location.coords?.longitude)
      || Math.abs(location.coords.latitude) > 90 || Math.abs(location.coords.longitude) > 180) continue
    if (!newest || location.timestamp >= newest.timestamp) newest = location
  }
  return newest
}

export function shouldPublishTripLocation(lastPublishedAt, now = Date.now()) {
  if (!Number.isFinite(now)) return false
  if (lastPublishedAt == null || !Number.isFinite(lastPublishedAt)) return true
  // A clock correction must not suppress sharing indefinitely.
  return now < lastPublishedAt || now - lastPublishedAt >= LOCATION_PUBLISH_MIN_INTERVAL_MS
}
