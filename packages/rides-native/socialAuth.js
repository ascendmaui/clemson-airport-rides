/**
 * Social providers for both apps. Rider and driver both sign in through Clerk
 * (useSSO / native Apple / native Google), then bridge into Supabase via
 * /api/clerk-supabase-session. Supabase's own Google/Apple/Facebook providers are off.
 */

export const RIDER_SOCIAL_PROVIDERS = [
  { id: 'apple', strategy: 'oauth_apple', label: 'Apple' },
  { id: 'google', strategy: 'oauth_google', label: 'Google' },
  { id: 'facebook', strategy: 'oauth_facebook', label: 'Facebook' },
]

export const DRIVER_SOCIAL_PROVIDERS = RIDER_SOCIAL_PROVIDERS

export function socialStrategy(providerId) {
  const match = RIDER_SOCIAL_PROVIDERS.find((provider) => provider.id === providerId)
  if (!match) throw new Error('Unknown social provider')
  return match.strategy
}

export function isNativeProviderUnavailable(error) {
  const msg = String(error?.message || error || '')
  return /only available on|OAuth-based flow|useSSO|not available on this device|expo-apple-authentication is required|Google Sign-In/i.test(msg)
}

export function clerkErrorMessage(error) {
  const list = error && typeof error === 'object' ? error.errors : null
  const first = Array.isArray(list) ? list[0] : null
  if (first?.longMessage) return String(first.longMessage)
  if (first?.message) return String(first.message)
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && error.message) return String(error.message)
  return 'Social sign-in failed'
}

/**
 * Classify a Clerk useSSO / native sign-in result.
 * Browser cancel is non-fatal. A native cancel has no session and no browser result.
 */
export function clerkSessionOutcome(result) {
  const browser = result?.authSessionResult
  if (browser && browser.type !== 'success') return { kind: 'cancelled' }
  if (!result?.createdSessionId) {
    const status = result?.signUp?.status || result?.signIn?.status || ''
    if (status === 'missing_requirements') return { kind: 'missing_requirements', status }
    if (status === 'needs_second_factor' || status === 'needs_first_factor') return { kind: 'needs_more', status }
    if (!browser) return { kind: 'cancelled' }
    return { kind: 'incomplete', status }
  }
  return { kind: 'session', sessionId: result.createdSessionId }
}

export function splitPersonName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return null
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || parts[0] }
}
