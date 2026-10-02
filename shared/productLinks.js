/** Canonical public surfaces for the one Clemson RIDES product. */

<<<<<<< Updated upstream
/** Stable production web host (johnmatveyev-lab / clemson-airport-rides). Prefer this over the older clemson-rides.vercel.app alias. */
export const WEB_ORIGIN = 'https://clemson-airport-rides.vercel.app'

/** Passenger soft-launch QR target — hash router book home (campus / airport / game-day entry). */
export const WEB_BOOK_URL = `${WEB_ORIGIN}/#/home`

/** Airport schedule + 25% deposit hold. */
export const WEB_SCHEDULE_URL = `${WEB_ORIGIN}/#/schedule`

/** Driver desk (accept rides). */
export const WEB_DRIVER_URL = `${WEB_ORIGIN}/#/driver`

/** Driver onboarding / signup. */
export const WEB_DRIVER_SIGNUP_URL = `${WEB_ORIGIN}/#/driver-signup`
=======
export const WEB_ORIGIN = 'https://clemsonrides.com'
>>>>>>> Stashed changes

export const RIDER_EXPO_PROJECT = 'https://expo.dev/accounts/johnmatveyev/projects/clemson-rides-rider'

export const DRIVER_EXPO_PROJECT = 'https://expo.dev/accounts/johnmatveyev/projects/clemson-rides-driver'

export const SUPPORT_EMAIL = 'rides@clemson.edu'

/**
 * Public App Store / TestFlight and Google Play URLs.
 * Stay null until a real listing is published. Do not invent store ids.
 */
export const IOS_STORE_URL = null

export const ANDROID_STORE_URL = null

/** Install targets for the marketing download section. iOS and Android share the Expo project until a store URL exists. */
export const APP_DOWNLOADS = [
  {
    id: 'rider',
    label: 'Rider',
    product: 'Clemson RIDES',
    href: RIDER_EXPO_PROJECT,
    iosHref: IOS_STORE_URL || RIDER_EXPO_PROJECT,
    androidHref: ANDROID_STORE_URL || RIDER_EXPO_PROJECT,
    iosNote: IOS_STORE_URL
      ? 'App Store or TestFlight'
      : 'No public TestFlight or App Store link yet. This opens the rider Expo project.',
    androidNote: ANDROID_STORE_URL
      ? 'Google Play'
      : 'No Google Play link yet. This opens the rider Expo project.',
  },
  {
    id: 'driver',
    label: 'Driver',
    product: 'Clemson RIDES Driver',
    href: DRIVER_EXPO_PROJECT,
    iosHref: IOS_STORE_URL || DRIVER_EXPO_PROJECT,
    androidHref: ANDROID_STORE_URL || DRIVER_EXPO_PROJECT,
    iosNote: IOS_STORE_URL
      ? 'App Store or TestFlight'
      : 'No public TestFlight or App Store link yet. This opens the driver Expo project.',
    androidNote: ANDROID_STORE_URL
      ? 'Google Play'
      : 'No Google Play link yet. This opens the driver Expo project.',
  },
]

/**
 * Expo slug for TestFlight 1.0.0 `com.ascendmaui.clemsonairportrides` in `apps/mobile`.
 * Do not advertise that project as the current rider or driver install.
 */
export const FROZEN_EXPO_SLUG = 'clemson-airport-rides'
