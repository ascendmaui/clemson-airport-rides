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

export default googleAuthConfig
