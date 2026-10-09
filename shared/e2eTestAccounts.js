/** Reserved accounts used by the ride harness, isolated from normal matching. */
export function isE2ETestEmail(email) {
  return typeof email === 'string' && /^e2e\+[a-z0-9._-]+@clemsonrides\.com$/i.test(email)
}

export function isE2ETestUser(userOrProfile) {
  return isE2ETestEmail(userOrProfile?.email) || userOrProfile?.app_metadata?.e2e_test === true
}
