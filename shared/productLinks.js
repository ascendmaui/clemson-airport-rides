/** Canonical public surfaces for the one Clemson RIDES product. */

/** Sole public production web host. vercel.app deploy aliases redirect here. */
export const WEB_ORIGIN = 'https://clemsonrides.com'

/** Passenger soft-launch QR target — hash router book home (campus / airport / game-day entry). */
export const WEB_BOOK_URL = `${WEB_ORIGIN}/#/home`

/** Airport schedule + 25% deposit hold. */
export const WEB_SCHEDULE_URL = `${WEB_ORIGIN}/#/schedule`

/** Driver desk (accept rides). */
export const WEB_DRIVER_URL = `${WEB_ORIGIN}/#/driver`

/** Driver onboarding / signup. */
export const WEB_DRIVER_SIGNUP_URL = `${WEB_ORIGIN}/#/driver-signup`

export const SUPPORT_EMAIL = 'rides@clemson.edu'

/**
 * Public App Store and Google Play URLs.
 * Stay null until a real listing for that specific app is published.
 * Do not invent store ids. This repo has no public TestFlight link.
 * Rider and driver are separate binaries, so one shared store URL is not used.
 */
export const IOS_STORE_URL = null

export const ANDROID_STORE_URL = null

export const RIDER_IOS_STORE_URL = null

export const RIDER_ANDROID_STORE_URL = null

export const DRIVER_IOS_STORE_URL = null

export const DRIVER_ANDROID_STORE_URL = null

const PUBLIC_STORE_HOST = /^https:\/\/(apps\.apple\.com|play\.google\.com)\//

/** A store button may use only an already-published App Store or Play Store https URL. */
export function publishedStoreUrl(url) {
  if (typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!PUBLIC_STORE_HOST.test(trimmed)) return null
  return trimmed
}

function installHref(storeUrl, webUrl) {
  return publishedStoreUrl(storeUrl) || webUrl
}

/** Store badge when that listing is published. Otherwise the web action the QR opens. */
function platformCta(storeUrl, liveLabel, webLabel) {
  return publishedStoreUrl(storeUrl) ? liveLabel : webLabel
}

/**
 * QR codes and iOS/Android buttons.
 * Rider opens booking. Driver opens the driver desk.
 * A public store listing replaces that web URL only for the app it belongs to.
 */
export const APP_DOWNLOADS = [
  {
    id: 'rider',
    label: 'Rider',
    product: 'Clemson RIDES',
    href: installHref(RIDER_IOS_STORE_URL, WEB_BOOK_URL),
    iosHref: installHref(RIDER_IOS_STORE_URL, WEB_BOOK_URL),
    androidHref: installHref(RIDER_ANDROID_STORE_URL, WEB_BOOK_URL),
    scanCta: 'Scan to book a ride',
    openCta: 'Open booking',
    heroCopy: 'Opens booking in the browser. Airport holds use a 25% deposit.',
    iosCta: platformCta(RIDER_IOS_STORE_URL, 'App Store', 'Book on iPhone'),
    androidCta: platformCta(RIDER_ANDROID_STORE_URL, 'Google Play', 'Book on Android'),
    iosNote: publishedStoreUrl(RIDER_IOS_STORE_URL)
      ? 'App Store'
      : 'The App Store listing is not live yet. This opens booking on clemsonrides.com.',
    androidNote: publishedStoreUrl(RIDER_ANDROID_STORE_URL)
      ? 'Google Play'
      : 'The Play Store listing is not live yet. This opens booking on clemsonrides.com.',
    blurb: 'One code for booking. iPhone and Android both open clemsonrides.com. The App Store and Play Store listings are not live yet.',
  },
  {
    id: 'driver',
    label: 'Driver',
    product: 'Clemson RIDES Driver',
    href: installHref(DRIVER_IOS_STORE_URL, WEB_DRIVER_URL),
    iosHref: installHref(DRIVER_IOS_STORE_URL, WEB_DRIVER_URL),
    androidHref: installHref(DRIVER_ANDROID_STORE_URL, WEB_DRIVER_URL),
    scanCta: 'Scan to open the driver desk',
    openCta: 'Open driver desk',
    heroCopy: 'Opens the driver web app so you can accept rides from the browser.',
    iosCta: platformCta(DRIVER_IOS_STORE_URL, 'App Store', 'Drive on iPhone'),
    androidCta: platformCta(DRIVER_ANDROID_STORE_URL, 'Google Play', 'Drive on Android'),
    iosNote: publishedStoreUrl(DRIVER_IOS_STORE_URL)
      ? 'App Store'
      : 'The App Store listing is not live yet. This opens the driver web app on clemsonrides.com.',
    androidNote: publishedStoreUrl(DRIVER_ANDROID_STORE_URL)
      ? 'Google Play'
      : 'The Play Store listing is not live yet. This opens the driver web app on clemsonrides.com.',
    blurb: 'One code for the driver web app. iPhone and Android both open clemsonrides.com. The App Store and Play Store listings are not live yet.',
  },
]

/**
 * Expo slug for TestFlight 1.0.0 `com.ascendmaui.clemsonairportrides` in `apps/mobile`.
 * Do not advertise that project as the current rider or driver install.
 */
export const FROZEN_EXPO_SLUG = 'clemson-airport-rides'
