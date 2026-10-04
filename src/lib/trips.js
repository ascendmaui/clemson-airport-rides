import { destPoint, pickupPoint } from '../../packages/rides-native/places.js'
import { createServerDriverTrip } from './payments'
import { requestFailureMessage } from './requestFailure.js'

export { requestFailureMessage }

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
  pickupLabel = null,
  pickupLat = null,
  pickupLng = null,
  tier = 'standard',
  isStudent = false,
  listCents = 0,
  autoAssign = false,
}) {
  void isStudent
  void listCents
  if (!riderId) throw new Error('Sign in required to request a driver')
  const assigning = autoAssign === true && !driverId
  if (!driverId && !assigning) throw new Error('Select a driver first')

  const lat = finitePin(destLat)
  const lng = finitePin(destLng)
  const drop = lat != null && lng != null
    ? { latitude: lat, longitude: lng }
    : destPoint(dest)
  const plat = finitePin(pickupLat)
  const plng = finitePin(pickupLng)
  const stadium = pickupPoint('Memorial Stadium')
  const pickup = plat != null && plng != null
    ? {
      latitude: plat,
      longitude: plng,
      label: String(pickupLabel || '').trim() || 'Current location',
    }
    : { latitude: stadium.latitude, longitude: stadium.longitude, label: 'Memorial Stadium' }
  const data = await createServerDriverTrip({
    ...(assigning ? { autoAssign: true } : { driverId }),
    dest,
    destLat: drop.latitude,
    destLng: drop.longitude,
    pickupLabel: pickup.label,
    pickupLat: pickup.latitude,
    pickupLng: pickup.longitude,
    tier: tier || 'standard',
  })
  if (!data?.trip?.id) throw new Error('Could not request trip')
  return data.trip
}
