export type SocialProviderId = 'apple' | 'google'

export interface SocialProvider {
  id: SocialProviderId
  label: string
  enabled?: boolean
  disabled?: boolean
  hidden?: boolean
  message?: string | null
  disabledLabel?: string
}

export const RIDER_SOCIAL_PROVIDERS: Array<SocialProvider>

export const DRIVER_SOCIAL_PROVIDERS: typeof RIDER_SOCIAL_PROVIDERS

export function isNativeProviderUnavailable(error: unknown): boolean

export function socialErrorMessage(error: unknown): string

export function splitPersonName(fullName?: string | null): { firstName: string; lastName: string } | null

export function appleFullName(fullName: unknown): string | null
