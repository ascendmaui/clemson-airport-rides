/**
 * Pure helpers for the rider stale-session guard (apps/rider/lib/freshAuth.ts).
 * Kept here so node:test can cover them without React Native.
 */

/** Clerk `session_exists` ("You're already signed in") in any of its shapes. */
export function isStaleSessionError(error) {
  const list = error && typeof error === 'object' ? error.errors : null
  if (Array.isArray(list) && list.some((item) => item?.code === 'session_exists')) return true
  if (error && typeof error === 'object' && error.code === 'session_exists') return true
  const msg = String((error && typeof error === 'object' && error.message) || error || '')
  return /session_exists|already signed in/i.test(msg)
}

/** Offline / fetch failures must not sign a rider out. */
export function isTransientNetworkError(error) {
  const msg = String((error && typeof error === 'object' && error.message) || error || '')
  return /network request failed|network error|failed to fetch|timed out|timeout|offline|internet connection/i.test(msg)
}
