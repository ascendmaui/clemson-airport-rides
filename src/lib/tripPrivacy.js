/**
 * Trip address privacy for driver-facing surfaces (post-ride, earnings, history).
 * Offer previews use the ~400m pin. Earnings history uses the neighborhood mask
 * from privacyDisplay.maskCompletedTripForDriver.
 */
export {
  APPROX_GRID_METERS,
  AREA_RADIUS_METERS,
  approximateTripPin as approximateLatLng,
  coarsePlaceLabel,
  displayFirstName,
  maskActiveAwareTrip as maskCompletedTripForDriver,
  driverFacingTrip,
} from './privacyDisplay.js'
