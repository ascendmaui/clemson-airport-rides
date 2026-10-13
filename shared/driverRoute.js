/**
 * Where a signed-in driver belongs.
 * Approved applicants open the shift at #/driver.
 * Anyone else stays on the application at #/driver-onboarding.
 */
export function driverRouteForOnboarding(onboardingStatus) {
  return onboardingStatus === 'approved' ? 'driver' : 'driver-onboarding'
}
