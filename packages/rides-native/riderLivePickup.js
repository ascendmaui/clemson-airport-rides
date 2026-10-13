/**
 * Live pickup pin for a ride that is still being booked.
 * The rider phone publishes a high-accuracy fix. The offered or matched
 * driver reads it. Booked pickup coordinates, fare, and matching stay put.
 */

export const RIDER_PICKUP_STREAM_STATUSES = ['searching', 'offered', 'accepted', 'arriving', 'arrived']

/** Fixes worse than this stay off the driver pin. 30 m is the outdoor high-accuracy gate. */
export const RIDER_FIX_MAX_ACCURACY_M = 30

/** About three feet. Smaller jitter does not publish again until the time gap. */
export const RIDER_FIX_MIN_MOVE_M = 1

export const RIDER_FIX_MAX_GAP_MS = 2000

/** A driver falls back to the booked pickup once the stream goes quiet. */
export const RIDER_FIX_MAX_AGE_MS = 90_000

export function shouldStreamRiderPickup(status) {
  return RIDER_PICKUP_STREAM_STATUSES.includes(String(status || ''))
}

function finite(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function metersBetween(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every((value) => Number.isFinite(value))) return null
  const earth = 6371000
  const toRad = (degrees) => (degrees * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Shape one GPS sample. Accuracy above the gate is rejected so a coarse
 * cached fix cannot drag the driver pin. Missing accuracy is allowed.
 */
export function normalizeRiderFix(body, updatedAt) {
  const lat = finite(body?.lat ?? body?.latitude)
  const lng = finite(body?.lng ?? body?.longitude)
  if (lat == null || lat < -90 || lat > 90) return { ok: false, error: 'A latitude is required' }
  if (lng == null || lng < -180 || lng > 180) return { ok: false, error: 'A longitude is required' }
  const rawAccuracy = body?.accuracy ?? body?.accuracy_m
  const accuracy = rawAccuracy == null || rawAccuracy === '' ? null : finite(rawAccuracy)
  if (rawAccuracy != null && rawAccuracy !== '' && accuracy == null) {
    return { ok: false, error: 'Accuracy is not a distance' }
  }
  if (accuracy != null && accuracy < 0) return { ok: false, error: 'Accuracy is not a distance' }
  if (accuracy != null && accuracy > RIDER_FIX_MAX_ACCURACY_M) {
    return { ok: false, error: 'Waiting for a closer GPS fix' }
  }
  let heading = body?.heading == null || body?.heading === '' ? null : finite(body.heading)
  if (heading != null && (heading < 0 || heading >= 360)) heading = null
  return {
    ok: true,
    fix: {
      lat,
      lng,
      accuracy_m: accuracy,
      heading,
      updated_at: updatedAt,
    },
  }
}

export function shouldPublishRiderFix(previous, next, nowMs) {
  const normalized = normalizeRiderFix(next, new Date(nowMs).toISOString())
  if (!normalized.ok) return false
  if (!previous) return true
  const elapsed = nowMs - Number(previous.at)
  if (!Number.isFinite(elapsed) || elapsed >= RIDER_FIX_MAX_GAP_MS) return true
  const moved = metersBetween(previous.lat, previous.lng, normalized.fix.lat, normalized.fix.lng)
  return moved != null && moved >= RIDER_FIX_MIN_MOVE_M
}

/**
 * Where the driver should put the pickup pin.
 * A fresh rider fix wins. The booked pickup is the fallback and is never rewritten.
 */
export function driverPickupTarget(card, now = Date.now()) {
  if (!card) return null
  const lat = finite(card.riderLat)
  const lng = finite(card.riderLng)
  const at = Date.parse(card.riderFixAt || '')
  const age = now - at
  const fresh = lat != null && lng != null && Number.isFinite(at) && age >= -5000 && age <= RIDER_FIX_MAX_AGE_MS
  if (fresh) return { latitude: lat, longitude: lng, live: true }
  const pickupLat = finite(card.pickupLat ?? card.pickup_lat)
  const pickupLng = finite(card.pickupLng ?? card.pickup_lng)
  if (pickupLat == null || pickupLng == null) return null
  return { latitude: pickupLat, longitude: pickupLng, live: false }
}
