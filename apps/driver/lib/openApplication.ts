/** Driver application screen. Expo Router file apps/driver/app/onboarding.tsx. */
export const DRIVER_APPLICATION_HREF = '/onboarding'

type ApplicationRouter = {
  push: (href: typeof DRIVER_APPLICATION_HREF) => void
}

/** Tap handler for Open application. Always navigates; a missing router is an error, not a no-op. */
export function openDriverApplication(router: ApplicationRouter): typeof DRIVER_APPLICATION_HREF {
  if (!router || typeof router.push !== 'function') {
    throw new Error('Could not open the driver application')
  }
  router.push(DRIVER_APPLICATION_HREF)
  return DRIVER_APPLICATION_HREF
}
