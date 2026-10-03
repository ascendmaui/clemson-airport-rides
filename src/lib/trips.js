import { CURRENT_LOCATION_LABEL, destPoint, isCurrentLocationLabel, pickupPoint } from '../../packages/rides-native/places.js'
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
  pickupLabel: pickupLabelIn = '',
  pickupLat = null,
  pickupLng = null,
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
  const pickupLatN = finitePin(pickupLat)
  const pickupLngN = finitePin(pickupLng)
  let pickup
  let pickupLabel
  if (pickupLatN != null && pickupLngN != null) {
    pickup = { latitude: pickupLatN, longitude: pickupLngN }
    pickupLabel = String(pickupLabelIn || '').trim() || CURRENT_LOCATION_LABEL
  } else if (isCurrentLocationLabel(pickupLabelIn)) {
    throw new Error('Current location is not available. Pick a campus or airport stop.')
  } else {
    pickup = pickupPoint(pickupLabelIn || 'Memorial Stadium')
    pickupLabel = String(pickupLabelIn || '').trim() || 'Memorial Stadium'
  }
  const data = await createServerDriverTrip({
    driverId,
    dest,
    destLat: drop.latitude,
    destLng: drop.longitude,
    pickupLabel,
    pickupLat: pickup.latitude,
    pickupLng: pickup.longitude,
    tier: tier || 'standard',
  })
  if (!data?.trip?.id) throw new Error('Could not request trip')
  return data.trip
}
