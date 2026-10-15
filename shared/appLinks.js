/**
 * Universal links and Android App Links for the Rider and Driver apps.
 * Paths here are the ones each Expo Router tree actually opens.
 * iOS path choice lives in apple-app-site-association. Android path choice
 * lives in each app's intentFilters and must list the same paths.
 */

export const APPLE_TEAM_ID = 'L85AF3V872'

export const RIDER_BUNDLE_ID = 'com.ascendmaui.clemsonrides.rider'

export const DRIVER_BUNDLE_ID = 'com.ascendmaui.clemsonrides.driver'

export const APP_LINK_HOSTS = Object.freeze(['clemsonrides.com', 'www.clemsonrides.com'])

export const BOOK_RIDE_PATH = '/book'

/** Apple rejects a redirect on this URL and requires application/json. */
export const AASA_PATH = '/.well-known/apple-app-site-association'

export const ASSETLINKS_PATH = '/.well-known/assetlinks.json'

/**
 * Play App Signing SHA-256 certificate fingerprints, colon-separated hex.
 * Replace REPLACE_WITH_SHA256_CERT_FINGERPRINT for each app. The public
 * assetlinks route stays disabled until every entry is a real fingerprint.
 */
export const ANDROID_SHA256_FINGERPRINT_PLACEHOLDER = 'REPLACE_WITH_SHA256_CERT_FINGERPRINT'

export const ANDROID_SHA256_FINGERPRINTS = Object.freeze({
  rider: Object.freeze([ANDROID_SHA256_FINGERPRINT_PLACEHOLDER]),
  driver: Object.freeze([ANDROID_SHA256_FINGERPRINT_PLACEHOLDER]),
})

const SHA256_CERT = /^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31}$/

/**
 * Rider paths. Expo routes:
 * book, ride, and drive open the booking home.
 * trip and trip/:id open the live trip screen.
 * auth/callback is the existing Google/Apple return route.
 * /drive on the website stays the Drive with us page when the app is absent.
 */
export const RIDER_LINK_PATHS = Object.freeze([
  Object.freeze({ apple: '/book', android: Object.freeze({ path: '/book' }), route: 'apps/rider/app/book.tsx' }),
  Object.freeze({ apple: '/ride', android: Object.freeze({ path: '/ride' }), route: 'apps/rider/app/ride.tsx' }),
  Object.freeze({ apple: '/drive', android: Object.freeze({ path: '/drive' }), route: 'apps/rider/app/drive.tsx' }),
  Object.freeze({ apple: '/trip', android: Object.freeze({ path: '/trip' }), route: 'apps/rider/app/trip/index.tsx' }),
  Object.freeze({ apple: '/trip/*', android: Object.freeze({ pathPrefix: '/trip/' }), route: 'apps/rider/app/trip/[id].tsx' }),
  Object.freeze({ apple: '/auth/callback', android: Object.freeze({ path: '/auth/callback' }), route: 'apps/rider/app/auth/callback.tsx' }),
])

/** Driver paths. /driver and /driver/* open the driver app, not /driver-signup. */
export const DRIVER_LINK_PATHS = Object.freeze([
  Object.freeze({ apple: '/driver', android: Object.freeze({ path: '/driver' }), route: 'apps/driver/app/driver/[[...path]].tsx' }),
  Object.freeze({ apple: '/driver/*', android: Object.freeze({ pathPrefix: '/driver/' }), route: 'apps/driver/app/driver/[[...path]].tsx' }),
])

export function appId(bundleId) {
  return `${APPLE_TEAM_ID}.${bundleId}`
}

export function appleAppSiteAssociation() {
  return {
    applinks: {
      apps: [],
      details: [
        {
          appID: appId(RIDER_BUNDLE_ID),
          paths: RIDER_LINK_PATHS.map((entry) => entry.apple),
        },
        {
          appID: appId(DRIVER_BUNDLE_ID),
          paths: DRIVER_LINK_PATHS.map((entry) => entry.apple),
        },
      ],
    },
  }
}

export function androidIntentData(linkPaths) {
  const data = []
  for (const host of APP_LINK_HOSTS) {
    for (const entry of linkPaths) {
      data.push({ scheme: 'https', host, ...entry.android })
    }
  }
  return data
}

function fingerprintsAreReal(list) {
  return Array.isArray(list) && list.length > 0 && list.every((value) => SHA256_CERT.test(String(value || '').trim()))
}

export function assetLinksEnabled(fingerprints = ANDROID_SHA256_FINGERPRINTS) {
  return fingerprintsAreReal(fingerprints?.rider) && fingerprintsAreReal(fingerprints?.driver)
}

export function assetLinksDocument(fingerprints = ANDROID_SHA256_FINGERPRINTS) {
  if (!assetLinksEnabled(fingerprints)) return null
  const statements = [
    [RIDER_BUNDLE_ID, fingerprints.rider],
    [DRIVER_BUNDLE_ID, fingerprints.driver],
  ]
  return statements.map(([packageName, prints]) => ({
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: packageName,
      sha256_cert_fingerprints: prints.map((value) => String(value).trim()),
    },
  }))
}
