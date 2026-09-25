export type SocialProviderId = 'apple' | 'google'

export const RIDER_SOCIAL_PROVIDERS: Array<{
  id: SocialProviderId
  label: string
}>

export const DRIVER_SOCIAL_PROVIDERS: typeof RIDER_SOCIAL_PROVIDERS

export function isNativeProviderUnavailable(error: unknown): boolean

export function socialErrorMessage(error: unknown): string

export function splitPersonName(fullName?: string | null): { firstName: string; lastName: string } | null

export function appleFullName(fullName: unknown): string | null
