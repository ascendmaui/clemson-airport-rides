/**
 * Public TestFlight beta for the Clemson Rides rider iPhone app.
 * Rider build 48, approved for external testing, open to anyone with the link.
 * The driver app has no public beta link, so nothing here covers it.
 */
export const RIDER_BETA_URL = 'https://testflight.apple.com/join/hFe8Rw7U'

/** Apple's free TestFlight app on the App Store. */
export const TESTFLIGHT_APP_URL = 'https://apps.apple.com/app/testflight/id899247664'

/** QR of RIDER_BETA_URL, committed as a static SVG (dark modules, white field, 4-module quiet zone). */
export const RIDER_BETA_QR_SRC = '/qr/rider-iphone-beta.svg'

/** Section id used on the Get the App page and the /download page. */
export const RIDER_BETA_SECTION_ID = 'iphone-beta'

export const RIDER_BETA_COPY = {
  kicker: 'iPhone',
  title: 'Get the iPhone app (beta)',
  body: "Install Apple's free TestFlight app, then tap Join to get Clemson Rides on your iPhone.",
  cta: 'Join the iPhone beta',
  qrAlt: 'QR code that opens the Clemson Rides iPhone beta on TestFlight',
  qrHint: 'Scan with your iPhone camera',
  testflightLink: 'Get TestFlight on the App Store',
}
