import { destPoint, pickupPoint } from '../../packages/rides-native/places.js'
import { createServerDriverTrip } from './payments'

/**
 * Preferred-driver request. The server writes fare_cents. A client list price
 * or student flag is not the fare (the fare trigger would reject it anyway).
 * Pins only tell the server where the ride is. Airport labels are canonicalized
 * there, so these coordinates cannot set the amount.
 */

// Number(null), Number(''), and Number('   ') are 0, which is finite. A blank
// pin is missing, not the origin. An explicit 0 is still a coordinate.
function finitePin(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export async function requestDriverTrip({
  riderId,
  driverId,
  dest = 'GSP Airport',
  destLat = null,
  destLng = null,
  tier = 'standard',
  isStudent = false,
  listCents = 0,
}) {
  void isStudent
  void listCents
  if (!riderId) throw new Error('Sign in required to request a driver')
  if (!driverId) throw new Error('Select a driver first')

  const lat = finitePin(destLat)
  const lng = finitePin(destLng)
  const drop = lat != null && lng != null
    ? { latitude: lat, longitude: lng }
    : destPoint(dest)
  const pickup = pickupPoint('Memorial Stadium')
  const data = await createServerDriverTrip({
    driverId,
    dest,
    destLat: drop.latitude,
    destLng: drop.longitude,
    pickupLabel: 'Memorial Stadium',
    pickupLat: pickup.latitude,
    pickupLng: pickup.longitude,
    tier: tier || 'standard',
  })
  if (!data?.trip?.id) throw new Error('Could not request trip')
  return data.trip
}
