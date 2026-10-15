/**
 * Prominent disclosure shown in the app before the OS background-location
 * prompt (Google Play User Data policy; also answers Apple's "why Always").
 * Pure, so it runs under node:test.
 */
export const BACKGROUND_LOCATION_DISCLOSURE = Object.freeze({
  title: 'Share your location during trips',
  body:
    'Clemson Rides Driver collects your location data to show your car to your rider, '
    + 'track trip progress and time your pickup and drop-off, even when the app is closed '
    + 'or not in use, such as while you navigate in Maps or your phone is locked.',
  points: Object.freeze([
    'Collected: your precise location, only while you have an active trip.',
    'Used in the background so your rider can see you while you drive with another app open.',
    'Location sharing stops when the trip ends. It is not used for ads.',
  ]),
  next: 'On the next screen, choose "Allow all the time" (Android) or "Always" (iPhone).',
  accept: 'Continue',
  decline: 'Not now',
})

export const DISCLOSURE_DECLINED_NOTE =
  'Background location is off for this trip. Keep Clemson Rides open so your rider can see you.'

/**
 * Show the disclosure only when background permission is not granted yet and
 * the driver has not already answered it for this trip.
 */
export function shouldShowLocationDisclosure({
  granted,
  answeredTripId,
  tripId,
}: { granted: boolean; answeredTripId: string | null; tripId: string }): boolean {
  if (granted) return false
  return answeredTripId !== tripId
}
