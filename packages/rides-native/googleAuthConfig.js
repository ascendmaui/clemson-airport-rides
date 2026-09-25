/**
 * Configuration and readiness check for Google Sign-In via Supabase Auth.
 * Reads expected public environment variables (e.g. EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
 * EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) without requiring secret keys in the app binary.
 *
 * When unconfigured, returns { enabled: false, missing: [...], redirectUri }
 * so the UI can hide or disable the Google button with an honest
 * "Google sign-in is coming soon" message instead of failing at tap time.
 */

import { googleOAuthRedirect } from './googleAuth.js'

export const GOOGLE_SIGN_IN_COMING_SOON = 'Google sign-in is coming soon'
export const GOOGLE_AUTH_COMING_SOON = GOOGLE_SIGN_IN_COMING_SOON

export const GOOGLE_IOS_CLIENT_ID_KEY = 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'
export const GOOGLE_WEB_CLIENT_ID_KEY = 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'

export const EXPECTED_GOOGLE_ENV_VARS = Object.freeze([
  GOOGLE_IOS_CLIENT_ID_KEY,
  GOOGLE_WEB_CLIENT_ID_KEY,
])

export const GOOGLE_AUTH_ENV_VARS = EXPECTED_GOOGLE_ENV_VARS

/**
 * Safely reads and trims a value from an environment object.
 */
function readEnvValue(env, key) {
  if (!env || typeof env !== 'object') return null
  const val = env[key]
  if (val == null) return null
  const trimmed = String(val).trim()
  return trimmed || null
}

/**
 * Checks whether an expected env variable is satisfied.
 * Also accommodates common web client id aliases.
 */
function isVarConfigured(env, varName) {
  if (!env || typeof env !== 'object') return false
  if (readEnvValue(env, varName)) return true

  // Support EXPO_PUBLIC_WEB_CLIENT_ID or EXPO_PUBLIC_GOOGLE_CLIENT_ID as fallbacks for web client id
  if (varName === GOOGLE_WEB_CLIENT_ID_KEY) {
    if (readEnvValue(env, 'EXPO_PUBLIC_WEB_CLIENT_ID')) return true
    if (readEnvValue(env, 'EXPO_PUBLIC_GOOGLE_CLIENT_ID')) return true
  }

  return false
}

/**
 * Resolves readiness and redirect config for Google sign-in.
 *
 * @param {Record<string, string | undefined> | object} [envOrOptions] - Env object or options bag
 * @param {object | string} [optionsOrScheme] - Options bag or scheme string
 * @returns {{ enabled: boolean, missing: string[], redirectUri: string }}
 */
export function googleAuthConfig(envOrOptions = process.env, optionsOrScheme = {}) {
  let env = envOrOptions
  let options = typeof optionsOrScheme === 'string' ? { scheme: optionsOrScheme } : { ...(optionsOrScheme || {}) }

  if (envOrOptions && typeof envOrOptions === 'object') {
    if ('env' in envOrOptions && envOrOptions.env && typeof envOrOptions.env === 'object') {
      options = { ...envOrOptions, ...options }
      env = envOrOptions.env
    } else if (
      ('scheme' in envOrOptions || 'redirectUri' in envOrOptions || 'required' in envOrOptions || 'platform' in envOrOptions) &&
      !Object.keys(envOrOptions).some((k) => k.startsWith('EXPO_PUBLIC_'))
    ) {
      options = { ...envOrOptions, ...options }
      env = process.env || {}
    } else if (envOrOptions.scheme && !options.scheme) {
      options.scheme = envOrOptions.scheme
    }
  }

  if (!env || typeof env !== 'object') {
    env = process.env || {}
  }

  // Resolve expected variables
  let expected = EXPECTED_GOOGLE_ENV_VARS
  if (Array.isArray(options.required) && options.required.length > 0) {
    expected = options.required
  } else if (Array.isArray(options.expected) && options.expected.length > 0) {
    expected = options.expected
  } else if (options.platform === 'web') {
    expected = [GOOGLE_WEB_CLIENT_ID_KEY]
  } else if (options.platform === 'android') {
    expected = ['EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID', GOOGLE_WEB_CLIENT_ID_KEY]
  } else if (options.platform === 'ios') {
    expected = [GOOGLE_IOS_CLIENT_ID_KEY, GOOGLE_WEB_CLIENT_ID_KEY]
  }

  const missing = []
  for (const varName of expected) {
    if (!isVarConfigured(env, varName)) {
      missing.push(varName)
    }
  }

  const enabled =
    options.mode === 'any' || options.requireAll === false
      ? missing.length < expected.length
      : missing.length === 0

  // Resolve redirectUri
  const defaultScheme =
    (typeof env.EXPO_PUBLIC_APP_SCHEME === 'string' && env.EXPO_PUBLIC_APP_SCHEME.trim()) ||
    'clemsonrides-driver'

  const scheme = options.scheme || defaultScheme
  const redirectUri =
    typeof options.redirectUri === 'string' && options.redirectUri.trim()
      ? options.redirectUri.trim()
      : googleOAuthRedirect(scheme, options.path)

  const result = {
    enabled,
    missing,
    redirectUri,
  }

  // Define non-enumerable helper properties so assert.deepEqual and JSON.stringify
  // only inspect { enabled, missing, redirectUri }, but callers can access convenience fields.
  Object.defineProperties(result, {
    message: {
      value: enabled ? null : GOOGLE_SIGN_IN_COMING_SOON,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    statusMessage: {
      value: enabled ? null : GOOGLE_SIGN_IN_COMING_SOON,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    comingSoonMessage: {
      value: GOOGLE_SIGN_IN_COMING_SOON,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    iosClientId: {
      value: readEnvValue(env, GOOGLE_IOS_CLIENT_ID_KEY),
      enumerable: false,
      configurable: true,
      writable: true,
    },
    webClientId: {
      value:
        readEnvValue(env, GOOGLE_WEB_CLIENT_ID_KEY) ||
        readEnvValue(env, 'EXPO_PUBLIC_WEB_CLIENT_ID') ||
        readEnvValue(env, 'EXPO_PUBLIC_GOOGLE_CLIENT_ID'),
      enumerable: false,
      configurable: true,
      writable: true,
    },
  })

  return result
}

export const getGoogleAuthConfig = googleAuthConfig

export function isGoogleAuthEnabled(env = process.env, options) {
  return googleAuthConfig(env, options).enabled
}

export function googleAuthStatusMessage(configOrEnv, options) {
  const config =
    configOrEnv && typeof configOrEnv === 'object' && 'enabled' in configOrEnv
      ? configOrEnv
      : googleAuthConfig(configOrEnv, options)
  return config.enabled ? null : GOOGLE_SIGN_IN_COMING_SOON
}

export function googleAuthButtonState(configOrEnv, options) {
  const config =
    configOrEnv && typeof configOrEnv === 'object' && 'enabled' in configOrEnv && Array.isArray(configOrEnv.missing)
      ? configOrEnv
      : googleAuthConfig(configOrEnv, options)
  return {
    enabled: Boolean(config.enabled),
    disabled: !config.enabled,
    hidden: !config.enabled,
    message: config.enabled ? null : GOOGLE_SIGN_IN_COMING_SOON,
    redirectUri: config.redirectUri,
  }
}

/**
 * Maps raw googleAuth and OAuth errors into friendly, user-facing error messages
 * without leaking internal server config, redirect allowlists, or env var names.
 *
 * @param {unknown} error - Error from startGoogleOAuth, completeGoogleSession, or OAuth flow
 * @returns {Error & { code?: string, status?: number, cancelled?: boolean }}
 */
export function mapGoogleAuthError(error) {
  if (!error) {
    const err = new Error('Google sign-in failed. Please try again.')
    err.code = 'google_auth_failed'
    return err
  }

  const raw = String(error?.message || error || '').trim()
  const code = String(error?.code || '').trim().toLowerCase()
  const status = error?.status

  if (raw === GOOGLE_SIGN_IN_COMING_SOON) {
    const err = error instanceof Error ? error : new Error(raw)
    err.code = 'google_auth_coming_soon'
    return err
  }

  if (
    /supabase is not configured|expo_public_supabase|anon[_\s]?key|service[_\s]?role/i.test(raw)
  ) {
    const err = new Error('Authentication is temporarily unavailable. Please try again shortly.')
    err.code = 'supabase_not_configured'
    return err
  }

  if (
    /google.*not configured|enable the google provider|oauth client|missing.*client[_\s]?id|expo_public_google/i.test(raw) ||
    code === 'google_not_configured'
  ) {
    const err = new Error(GOOGLE_SIGN_IN_COMING_SOON)
    err.code = 'google_auth_not_configured'
    return err
  }

  if (
    /rejected|access_denied|user denied|user_canceled|user_cancelled|canceled|cancelled|consent_denied/i.test(raw) ||
    code === 'access_denied' ||
    code === 'user_cancelled'
  ) {
    const err = new Error('Google sign-in was canceled.')
    err.code = 'user_cancelled'
    err.cancelled = true
    return err
  }

  if (
    /redirect allow|did not return a session|invalid[_\s]?redirect/i.test(raw)
  ) {
    const err = new Error('Could not complete Google sign-in. Please try again.')
    err.code = 'invalid_session'
    return err
  }

  if (
    status === 429 ||
    /rate limit|too many/i.test(raw) ||
    code === 'rate_limited' ||
    code === 'over_email_send_rate_limit'
  ) {
    const err = new Error('Too many sign-in attempts. Please wait a moment and try again.')
    err.code = 'rate_limited'
    err.status = 429
    return err
  }

  if (
    code === 'account_exists' ||
    code === 'user_already_exists' ||
    /user already registered|already been registered|already exists/i.test(raw)
  ) {
    const err = new Error('You already have an account with this email. Please sign in with your email and password.')
    err.code = 'account_exists'
    return err
  }

  if (
    /invalid_grant|expired|code has expired/i.test(raw) ||
    code === 'invalid_grant'
  ) {
    const err = new Error('Google sign-in session expired. Please try again.')
    err.code = 'session_expired'
    return err
  }

  if (
    /network|failed to fetch|econnrefused|etimedout|connection|offline/i.test(raw) ||
    code === 'network_error'
  ) {
    const err = new Error('Check your internet connection and try again.')
    err.code = 'network_error'
    return err
  }

  // If technical error or trace
  if (
    /\[object\s+object\]/i.test(raw) ||
    /syntaxerror|typeerror|referenceerror|rangeerror/i.test(raw) ||
    raw.includes('\n') ||
    raw.length > 100
  ) {
    const err = new Error('Google sign-in failed. Please try again.')
    err.code = 'google_auth_failed'
    return err
  }

  const err = error instanceof Error ? error : new Error(raw || 'Google sign-in failed. Please try again.')
  if (!err.code) err.code = 'google_auth_error'
  return err
}

export function googleAuthErrorMessage(error) {
  return mapGoogleAuthError(error).message
}

/**
 * Resolves an array of social providers (e.g. RIDER_SOCIAL_PROVIDERS),
 * annotating the Google provider with readiness disabled state, honest coming-soon copy,
 * or hiding it if requested.
 */
export function resolveSocialProviders(providers = [], envOrOptions = process.env, optionsOrScheme = {}) {
  const state = googleAuthButtonState(envOrOptions, optionsOrScheme)
  const isHidden = typeof optionsOrScheme === 'object' && optionsOrScheme?.hideDisabled

  const resolved = []
  for (const provider of providers) {
    if (provider.id === 'google') {
      if (isHidden && !state.enabled) continue
      resolved.push({
        ...provider,
        enabled: state.enabled,
        disabled: state.disabled,
        hidden: state.hidden,
        message: state.message,
        disabledLabel: `Continue with ${provider.label} (coming soon)`,
      })
    } else {
      resolved.push({ ...provider })
    }
  }
  return resolved
}

export default googleAuthConfig
