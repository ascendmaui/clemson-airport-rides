/**
 * POST /api/rider-live
 * Body: { tripId, lat, lng, accuracy?, heading? }
 * Merges metadata.rider_location for the signed-in rider while the ride is
 * still booking. Does not change pickup columns, fare, status, or matching.
 */
import { shouldStreamRiderPickup, normalizeRiderFix, RIDER_PICKUP_STREAM_STATUSES } from '../../packages/rides-native/riderLivePickup.js'

function metadataObject(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  return metadata
}

async function loadTrip(sb, tripId) {
  const { data, error } = await sb
    .from('trips')
    .select('id, rider_id, driver_id, status, metadata')
    .eq('id', tripId)
    .maybeSingle()
  if (error) {
    const err = new Error(error.message || 'Could not load trip')
    err.status = 500
    throw err
  }
  return data || null
}

export async function publishRiderPickup(sb, user, rawBody, { now = () => new Date() } = {}) {
  if (!user?.id) return { status: 401, body: { error: 'Sign in required' } }
  const tripId = String(rawBody?.tripId || rawBody?.trip_id || '').trim()
  if (!tripId) return { status: 400, body: { error: 'tripId required' } }

  const normalized = normalizeRiderFix(rawBody, now().toISOString())
  if (!normalized.ok) return { status: 400, body: { error: normalized.error } }

  const trip = await loadTrip(sb, tripId)
  if (!trip || trip.rider_id !== user.id) {
    return { status: 404, body: { error: 'Trip not found' } }
  }
  if (!shouldStreamRiderPickup(trip.status)) {
    return { status: 409, body: { error: 'Pickup tracking is only on while this ride is booking' } }
  }

  const patch = { rider_location: normalized.fix }
  if (typeof sb.rpc === 'function') {
    const { data, error } = await sb.rpc('merge_trip_metadata', {
      p_trip_id: trip.id,
      p_patch: patch,
      p_expected_statuses: [...RIDER_PICKUP_STREAM_STATUSES],
    })
    if (!error && data) {
      return { status: 200, body: { ok: true, rider_location: normalized.fix } }
    }
  }

  const metadata = { ...metadataObject(trip.metadata), ...patch }
  const updated = await sb.from('trips').update({ metadata }).eq('id', trip.id).eq('rider_id', user.id)
  if (updated?.error) {
    return { status: 500, body: { error: updated.error.message || 'Could not save pickup location' } }
  }
  return { status: 200, body: { ok: true, rider_location: normalized.fix } }
}
