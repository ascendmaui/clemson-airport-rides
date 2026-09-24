export const RIDER_SOCIAL_PROVIDERS: Array<{
  id: 'apple' | 'google' | 'facebook'
  strategy: 'oauth_apple' | 'oauth_google' | 'oauth_facebook'
  label: string
}>

export const DRIVER_SOCIAL_PROVIDERS: typeof RIDER_SOCIAL_PROVIDERS

export function socialStrategy(
  providerId: 'apple' | 'google' | 'facebook',
): 'oauth_apple' | 'oauth_google' | 'oauth_facebook'

export function isNativeProviderUnavailable(error: unknown): boolean

export function clerkErrorMessage(error: unknown): string

export function clerkSessionOutcome(result: {
  createdSessionId?: string | null
  authSessionResult?: { type?: string } | null
  signIn?: { status?: string | null } | null
  signUp?: { status?: string | null } | null
}):
  | { kind: 'cancelled' }
  | { kind: 'missing_requirements'; status: string }
  | { kind: 'needs_more'; status: string }
  | { kind: 'incomplete'; status: string }
  | { kind: 'session'; sessionId: string }

export function splitPersonName(fullName?: string): { firstName: string; lastName: string } | null
