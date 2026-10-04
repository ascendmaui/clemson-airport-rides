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

export const RIDER_EXPO_PROJECT = 'https://expo.dev/accounts/johnmatveyev/projects/clemson-rides-rider'

export const DRIVER_EXPO_PROJECT = 'https://expo.dev/accounts/johnmatveyev/projects/clemson-rides-driver'

export const SUPPORT_EMAIL = 'rides@clemson.edu'

/**
 * Public App Store / TestFlight and Google Play URLs.
 * Stay null until a real listing is published. Do not invent store ids.
 */
export const IOS_STORE_URL = null

export const ANDROID_STORE_URL = null

/**
 * Install targets for the marketing download section.
 * Until a real store listing exists, rider opens the public booking page and
 * driver opens the driver desk. Both stay on https://clemsonrides.com.
 */
export const APP_DOWNLOADS = [
  {
    id: 'rider',
    label: 'Rider',
    product: 'Clemson RIDES',
    href: WEB_BOOK_URL,
    iosHref: IOS_STORE_URL || WEB_BOOK_URL,
    androidHref: ANDROID_STORE_URL || WEB_BOOK_URL,
    iosNote: IOS_STORE_URL
      ? 'App Store or TestFlight'
      : 'Book a ride at clemsonrides.com.',
    androidNote: ANDROID_STORE_URL
      ? 'Google Play'
      : 'Book a ride at clemsonrides.com.',
  },
  {
    id: 'driver',
    label: 'Driver',
    product: 'Clemson RIDES Driver',
    href: WEB_DRIVER_URL,
    iosHref: IOS_STORE_URL || WEB_DRIVER_URL,
    androidHref: ANDROID_STORE_URL || WEB_DRIVER_URL,
    iosNote: IOS_STORE_URL
      ? 'App Store or TestFlight'
      : 'Open the driver desk at clemsonrides.com.',
    androidNote: ANDROID_STORE_URL
      ? 'Google Play'
      : 'Open the driver desk at clemsonrides.com.',
  },
]

/**
 * Expo slug for TestFlight 1.0.0 `com.ascendmaui.clemsonairportrides` in `apps/mobile`.
 * Do not advertise that project as the current rider or driver install.
 */
export const FROZEN_EXPO_SLUG = 'clemson-airport-rides'
