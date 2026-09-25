/**
 * Social authentication helpers for rider and driver apps.
 * Both apps use native Apple sign-in and Supabase Google OAuth directly.
 */

export const RIDER_SOCIAL_PROVIDERS = [
  { id: 'apple', label: 'Apple' },
  { id: 'google', label: 'Google' },
]

export const DRIVER_SOCIAL_PROVIDERS = RIDER_SOCIAL_PROVIDERS

export function isNativeProviderUnavailable(error) {
  const msg = String(error?.message || error || '')
  return /only available on|not available on this device|expo-apple-authentication is required|Apple sign-in is not available|Google sign-in is not available/i.test(msg)
}

export function socialErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error && error.message) return String(error.message)
  if (typeof error === 'string' && error.trim()) return error.trim()
  return 'Social sign-in failed'
}

export function splitPersonName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return null
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || parts[0] }
}

export function appleFullName(fullName) {
  if (!fullName) return null
  if (typeof fullName === 'string') {
    const trimmed = fullName.trim()
    return trimmed || null
  }
  if (typeof fullName === 'object') {
    const parts = [fullName.givenName, fullName.middleName, fullName.familyName]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean)
    if (parts.length) return parts.join(' ')
    if (typeof fullName.nickname === 'string' && fullName.nickname.trim()) {
      return fullName.nickname.trim()
    }
  }
  return null
}
