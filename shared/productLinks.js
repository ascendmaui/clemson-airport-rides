/** Canonical public surfaces for the one Clemson RIDES product. */

/** Sole public production web host. vercel.app deploy aliases redirect here. */
export const WEB_ORIGIN = 'https://clemsonrides.com'

/** Passenger soft-launch QR target — hash router book home (campus / airport / game-day entry). */
export const WEB_BOOK_URL = `${WEB_ORIGIN}/#/home`

/** Airport schedule. The fare is charged when the trip ends. */
export const WEB_SCHEDULE_URL = `${WEB_ORIGIN}/#/schedule`

/** Driver desk (accept rides). */
export const WEB_DRIVER_URL = `${WEB_ORIGIN}/#/driver`

/** Driver onboarding / signup. */
export const WEB_DRIVER_SIGNUP_URL = `${WEB_ORIGIN}/#/driver-signup`

/** Public support mailbox. Override with SUPPORT_EMAIL; web and apps may set the prefixed aliases. */
export const DEFAULT_SUPPORT_EMAIL = 'rides@clemsonrides.com'

const SUPPORT_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function pickSupportAddress(value) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return SUPPORT_ADDRESS.test(trimmed) ? trimmed : ''
}

/**
 * Support mailbox for Reply-To, mailto links, and contact copy.
 * Pass an env object in tests. With no argument, reads SUPPORT_EMAIL, then
 * VITE_SUPPORT_EMAIL, then EXPO_PUBLIC_SUPPORT_EMAIL. Those member reads stay
 * direct so Vite and Expo can inline them.
 */
export function supportEmail(env) {
  if (env && typeof env === 'object') {
    return pickSupportAddress(env.SUPPORT_EMAIL)
      || pickSupportAddress(env.VITE_SUPPORT_EMAIL)
      || pickSupportAddress(env.EXPO_PUBLIC_SUPPORT_EMAIL)
      || DEFAULT_SUPPORT_EMAIL
  }
  const server = typeof process !== 'undefined' ? process.env.SUPPORT_EMAIL : ''
  const web = typeof process !== 'undefined' ? process.env.VITE_SUPPORT_EMAIL : ''
  const app = typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_SUPPORT_EMAIL : ''
  return pickSupportAddress(server) || pickSupportAddress(web) || pickSupportAddress(app) || DEFAULT_SUPPORT_EMAIL
}

/** Canonical default. Call supportEmail() when the env override should apply. */
export const SUPPORT_EMAIL = DEFAULT_SUPPORT_EMAIL

export function supportMailto(subject, body) {
  const email = supportEmail()
  const params = []
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`)
  if (body) params.push(`body=${encodeURIComponent(body)}`)
  return params.length ? `mailto:${email}?${params.join('&')}` : `mailto:${email}`
}

/**
 * Public App Store and Google Play URLs.
 * Stay null until a real listing for that specific app is published.
 * Do not invent store ids. Rider and driver have separate public TestFlight betas.
 * Rider and driver are separate binaries, so one shared store URL is not used.
 */
export const IOS_STORE_URL = null

export const ANDROID_STORE_URL = null

export const RIDER_IOS_STORE_URL = null

export const RIDER_ANDROID_STORE_URL = null

export const DRIVER_IOS_STORE_URL = null

export const DRIVER_ANDROID_STORE_URL = null

export const RIDER_TESTFLIGHT_URL = 'https://testflight.apple.com/join/DXcYmBQg'

export const DRIVER_TESTFLIGHT_URL = 'https://testflight.apple.com/join/P7PD2FQK'

const PUBLIC_STORE_HOST = /^https:\/\/(apps\.apple\.com|play\.google\.com)\//

/** A store button may use only an already-published App Store or Play Store https URL. */
export function publishedStoreUrl(url) {
  if (typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!PUBLIC_STORE_HOST.test(trimmed)) return null
  return trimmed
}

/** Accept only a public TestFlight join link on Apple's HTTPS host. */
export function publicTestFlightUrl(url) {
  if (typeof url !== 'string') return null
  const trimmed = url.trim()
  return /^https:\/\/testflight\.apple\.com\/join\/[A-Za-z0-9]+$/.test(trimmed) ? trimmed : null
}

function installHref(storeUrl, webUrl) {
  return publishedStoreUrl(storeUrl) || webUrl
}

/**
 * Web booking and driver desk remain available on every platform.
 * iPhone install links use each app's public beta until its App Store listing is live.
 */
export const APP_DOWNLOADS = [
  {
    id: 'rider',
    label: 'Rider',
    product: 'Clemson RIDES Rider',
    href: WEB_BOOK_URL,
    testflightHref: publicTestFlightUrl(RIDER_TESTFLIGHT_URL),
    iosHref: publishedStoreUrl(RIDER_IOS_STORE_URL) || publicTestFlightUrl(RIDER_TESTFLIGHT_URL) || WEB_BOOK_URL,
    androidHref: installHref(RIDER_ANDROID_STORE_URL, WEB_BOOK_URL),
    iosNote: publishedStoreUrl(RIDER_IOS_STORE_URL)
      ? 'App Store'
      : 'iPhone: install the public beta through TestFlight.',
    androidNote: publishedStoreUrl(RIDER_ANDROID_STORE_URL)
      ? 'Google Play'
      : 'The Play Store listing is not live yet. This opens booking on clemsonrides.com.',
    blurb: 'iPhone: install the public beta through TestFlight. Android: book on clemsonrides.com while the Play Store listing is not live yet.',
  },
  {
    id: 'driver',
    label: 'Driver',
    product: 'Clemson RIDES Driver',
    href: WEB_DRIVER_URL,
    testflightHref: publicTestFlightUrl(DRIVER_TESTFLIGHT_URL),
    iosHref: publishedStoreUrl(DRIVER_IOS_STORE_URL) || publicTestFlightUrl(DRIVER_TESTFLIGHT_URL) || WEB_DRIVER_URL,
    androidHref: installHref(DRIVER_ANDROID_STORE_URL, WEB_DRIVER_URL),
    iosNote: publishedStoreUrl(DRIVER_IOS_STORE_URL)
      ? 'App Store'
      : 'iPhone: install the public beta through TestFlight.',
    androidNote: publishedStoreUrl(DRIVER_ANDROID_STORE_URL)
      ? 'Google Play'
      : 'The Play Store listing is not live yet. This opens the driver web app on clemsonrides.com.',
    blurb: 'iPhone: install the public beta through TestFlight. Android: open the driver desk on clemsonrides.com while the Play Store listing is not live yet.',
  },
]

/**
 * Expo slug for TestFlight 1.0.0 `com.ascendmaui.clemsonairportrides` in `apps/mobile`.
 * Do not advertise that project as the current rider or driver install.
 */
export const FROZEN_EXPO_SLUG = 'clemson-airport-rides'
export const WEB_DRIVER_RENTALS_URL = `${WEB_ORIGIN}/drivers/rentals`
export const WEB_PARTNER_JOIN_URL = `${WEB_ORIGIN}/partners/join`
