export interface GoogleAuthConfig {
  enabled: boolean
  missing: string[]
  redirectUri: string
  message?: string | null
  statusMessage?: string | null
  comingSoonMessage?: string
  iosClientId?: string | null
  webClientId?: string | null
}

export interface GoogleAuthConfigOptions {
  scheme?: string
  path?: string
  redirectUri?: string
  required?: string[]
  expected?: string[]
  platform?: 'ios' | 'android' | 'web' | string
  mode?: 'all' | 'any'
  requireAll?: boolean
}

export const GOOGLE_SIGN_IN_COMING_SOON: string
export const GOOGLE_AUTH_COMING_SOON: string
export const GOOGLE_IOS_CLIENT_ID_KEY: string
export const GOOGLE_WEB_CLIENT_ID_KEY: string
export const EXPECTED_GOOGLE_ENV_VARS: readonly string[]
export const GOOGLE_AUTH_ENV_VARS: readonly string[]

export function googleAuthConfig(
  envOrOptions?: Record<string, string | undefined> | GoogleAuthConfigOptions,
  optionsOrScheme?: GoogleAuthConfigOptions | string
): GoogleAuthConfig

export function getGoogleAuthConfig(
  envOrOptions?: Record<string, string | undefined> | GoogleAuthConfigOptions,
  optionsOrScheme?: GoogleAuthConfigOptions | string
): GoogleAuthConfig

export function isGoogleAuthEnabled(
  env?: Record<string, string | undefined>,
  options?: GoogleAuthConfigOptions
): boolean

export function googleAuthStatusMessage(
  configOrEnv?: GoogleAuthConfig | Record<string, string | undefined>,
  options?: GoogleAuthConfigOptions
): string | null

export function googleAuthButtonState(
  configOrEnv?: GoogleAuthConfig | Record<string, string | undefined>,
  options?: GoogleAuthConfigOptions
): {
  enabled: boolean
  disabled: boolean
  hidden: boolean
  message: string | null
  redirectUri: string
}

export default googleAuthConfig
