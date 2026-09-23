/**
 * Trip address privacy for driver-facing surfaces (post-ride, earnings, history).
 * Earnings and other driver history views should call maskCompletedTripForDriver
 * before rendering labels or map pins.
 */
export {
  APPROX_GRID_METERS,
  AREA_RADIUS_METERS,
  approximateLatLng,
  coarsePlaceLabel,
  displayFirstName,
  maskCompletedTripForDriver,
  driverFacingTrip,
} from './privacyDisplay.js'
