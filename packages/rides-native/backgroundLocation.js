import { isLiveLocationStatus } from './liveFix.js'

export const LOCATION_PUBLISH_MIN_INTERVAL_MS = 4000

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
