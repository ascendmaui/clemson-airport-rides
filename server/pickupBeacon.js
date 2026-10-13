import {
  generatePickupCode,
  isPickupCode,
  pickupCodeForViewer,
  viewerMayReadPickupCode,
} from '../shared/pickupBeacon.js'

export {
  generatePickupCode,
  isPickupCode,
  pickupCodeForViewer,
  viewerMayReadPickupCode,
} from '../shared/pickupBeacon.js'

/**
 * Writes a code when a matched trip does not have one yet.
 * Missing table (migration not applied) returns null and does not throw.
 */
export async function ensureTripPickupCode(sb, tripId) {
  if (!sb || typeof sb.from !== 'function' || !tripId) return null
  try {
    const existing = await sb.from('trip_pickup_codes').select('code').eq('trip_id', tripId).maybeSingle()
    if (existing?.error) return null
    if (isPickupCode(existing?.data?.code)) return existing.data.code
    const code = generatePickupCode()
    const inserted = await sb.from('trip_pickup_codes').insert({ trip_id: tripId, code }).select('code').maybeSingle()
    if (inserted?.error) {
      const again = await sb.from('trip_pickup_codes').select('code').eq('trip_id', tripId).maybeSingle()
      return isPickupCode(again?.data?.code) ? again.data.code : null
    }
    return isPickupCode(inserted?.data?.code) ? inserted.data.code : null
  } catch {
    return null
  }
}

/**
 * API auth gate. Strangers get 403 and this function does not read the code.
 * The rider of an unmatched trip gets a null code. The matched pair gets the code.
 */
export async function readPickupBeacon(sb, user, tripId) {
  if (!user?.id) return { status: 401, body: { ok: false, error: 'Sign in required' } }
  const id = typeof tripId === 'string' ? tripId.trim() : ''
  if (!id) return { status: 400, body: { ok: false, error: 'tripId required' } }
  const read = await sb.from('trips').select('id, rider_id, driver_id, status').eq('id', id).maybeSingle()
  if (read?.error) return { status: 500, body: { ok: false, error: 'Could not load the trip' } }
  const trip = read?.data
  if (!trip) return { status: 404, body: { ok: false, error: 'Trip not found' } }
  const isRider = trip.rider_id === user.id
  const isDriver = Boolean(trip.driver_id) && trip.driver_id === user.id
  if (!isRider && !isDriver) {
    return { status: 403, body: { ok: false, error: 'Not allowed on this trip' } }
  }
  if (!viewerMayReadPickupCode(trip, user.id)) {
    return { status: 200, body: { ok: true, pickupCode: null } }
  }
  const code = await ensureTripPickupCode(sb, trip.id)
  return {
    status: 200,
    body: { ok: true, pickupCode: pickupCodeForViewer(trip, user.id, code) },
  }
}
