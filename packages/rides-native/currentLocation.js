import { CURRENT_LOCATION_LABEL } from './places.js'

/**
 * Ask first, then read a fresh fix. Denial and a failed read return no coordinates.
 * Callers must not substitute a last-known or catalog pin.
 */
export async function captureCurrentLocationPickup(ask, readFix) {
  const allowed = await ask()
  if (!allowed) return { ok: false, reason: 'denied' }
  let fix
  try {
    fix = await readFix()
  } catch (err) {
    const reason = err?.reason === 'denied' ? 'denied' : 'unavailable'
    return { ok: false, reason }
  }
  if (!fix || fix.ok === false) return { ok: false, reason: fix?.reason === 'denied' ? 'denied' : 'unavailable' }
  const lat = Number(fix.lat)
  const lng = Number(fix.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, reason: 'unavailable' }
  }
  return { ok: true, place: { label: CURRENT_LOCATION_LABEL, lat, lng } }
}
