/**
 * Web Google sign-in return URL and Supabase OAuth callback parsing.
 * redirectTo is the site root (`origin + '/'`), which is the URL Supabase
 * allow-lists for https://clemsonrides.com/. PKCE appends
 * ?code= there, and the Supabase client restores the session. This module
 * also reads implicit hash tokens and a code hidden inside the hash router,
 * then the app continues at #/home.
 */

export const AUTH_NEXT_STORAGE_KEY = 'clemson_auth_next'
export const AUTH_CALLBACK_ERROR_KEY = 'clemson_auth_callback_error'
export const GOOGLE_PROMO_STORAGE_KEY = 'clemson_google_promo'

const AUTH_QUERY_KEYS = [
  'code',
  'access_token',
  'refresh_token',
  'expires_in',
  'expires_at',
  'token_type',
  'type',
  'error',
  'error_code',
  'error_description',
  'provider_token',
  'provider_refresh_token',
]

const OAUTH_HASH_ROUTES = new Set([
  'auth',
  'callback',
  'access_token',
  'refresh_token',
  'error',
  'error_description',
  'code',
])

/** Site root on the current origin, e.g. https://clemsonrides.com/ */
export function googleOAuthRedirectTo(origin) {
  const base = String(origin || '').trim().replace(/\/+$/, '')
  if (!base) return '/'
  return `${base}/`
}

function hashParamString(rawHash) {
  if (!rawHash) return ''
  const qIndex = rawHash.indexOf('?')
  if (qIndex >= 0) return rawHash.slice(qIndex + 1)
  if (rawHash.startsWith('/')) return ''
  return rawHash
}

function readParams(href) {
  const url = new URL(href, 'https://clemsonrides.com')
  const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  const search = url.searchParams
  const hashParams = new URLSearchParams(hashParamString(rawHash))
  const pick = (key) => search.get(key) || hashParams.get(key) || ''
  const standardHash = rawHash && !rawHash.startsWith('/') && !rawHash.includes('?')
    ? new URLSearchParams(rawHash)
    : null
  return { url, rawHash, search, pick, standardHash }
}

export function parseWebAuthCallback(href) {
  if (!href || typeof href !== 'string') return null
  let parsed
  try {
    parsed = readParams(href)
  } catch {
    return null
  }
  const { rawHash, search, pick, standardHash } = parsed
  const code = pick('code')
  const accessToken = pick('access_token')
  const refreshToken = pick('refresh_token')
  const error = pick('error_description') || pick('error')
  if (!code && !(accessToken && refreshToken) && !error) return null
  const tokensInStandardHash = Boolean(
    standardHash && standardHash.get('access_token') && standardHash.get('refresh_token'),
  )
  return {
    code: code || null,
    accessToken: accessToken || null,
    refreshToken: refreshToken || null,
    error: error || null,
    codeInQuery: Boolean(search.get('code')),
    tokensInStandardHash,
    rawHash,
  }
}

/** Code lives only in the hash, so detectSessionInUrl will not exchange it. */
export function needsManualCodeExchange(callback) {
  return Boolean(callback?.code && !callback.codeInQuery && !callback.error)
}

/** Implicit tokens are not in the hash shape the Supabase client parses. */
export function needsManualTokenSession(callback) {
  return Boolean(
    callback
    && !callback.error
    && !callback.code
    && callback.accessToken
    && callback.refreshToken
    && !callback.tokensInStandardHash,
  )
}

function cleanAppHash(rawHash, targetPath, forceHash) {
  const qIndex = rawHash.indexOf('?')
  const routeAndPath = qIndex >= 0 ? rawHash.slice(0, qIndex) : rawHash
  const query = qIndex >= 0 ? rawHash.slice(qIndex + 1) : ''
  const routePart = routeAndPath.replace(/^\//, '').split('/')[0]
  const hashIsAppRoute = Boolean(routePart) && !routePart.includes('=') && !OAUTH_HASH_ROUTES.has(routePart)
  if (forceHash || !hashIsAppRoute) return `#/${targetPath}`
  const params = new URLSearchParams(query)
  for (const key of AUTH_QUERY_KEYS) params.delete(key)
  const rest = params.toString()
  const path = routeAndPath.startsWith('/') ? routeAndPath : `/${routeAndPath}`
  return rest ? `#${path}?${rest}` : `#${path}`
}

export function locationAfterAuthCallback(href, targetPath = 'home', { forceHash = false } = {}) {
  if (!parseWebAuthCallback(href)) return null
  const url = new URL(href, 'https://clemsonrides.com')
  for (const key of AUTH_QUERY_KEYS) url.searchParams.delete(key)
  const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  url.hash = cleanAppHash(rawHash, targetPath, forceHash)
  const search = url.searchParams.toString()
  return `${url.pathname}${search ? `?${search}` : ''}${url.hash}`
}

export function stashAuthNext(storage, params) {
  if (!storage) return
  if (!params?.next) {
    storage.removeItem(AUTH_NEXT_STORAGE_KEY)
    return
  }
  storage.setItem(AUTH_NEXT_STORAGE_KEY, JSON.stringify(params))
}

export function takeAuthNext(storage) {
  if (!storage) return null
  try {
    const raw = storage.getItem(AUTH_NEXT_STORAGE_KEY)
    storage.removeItem(AUTH_NEXT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.next !== 'string' || !parsed.next) return null
    return parsed
  } catch {
    return null
  }
}

export function stashGooglePromo(storage, promo) {
  if (!storage) return
  const code = String(promo || '').trim()
  if (!code) {
    storage.removeItem(GOOGLE_PROMO_STORAGE_KEY)
    return
  }
  storage.setItem(GOOGLE_PROMO_STORAGE_KEY, code)
}

export function takeGooglePromo(storage) {
  if (!storage) return ''
  try {
    const code = storage.getItem(GOOGLE_PROMO_STORAGE_KEY) || ''
    storage.removeItem(GOOGLE_PROMO_STORAGE_KEY)
    return String(code).trim()
  } catch {
    return ''
  }
}

export function rememberAuthCallbackError(storage, message) {
  if (!storage) return
  const text = String(message || '').trim()
  if (!text) {
    storage.removeItem(AUTH_CALLBACK_ERROR_KEY)
    return
  }
  storage.setItem(AUTH_CALLBACK_ERROR_KEY, text)
}

export function publishAuthCallbackError(storage, message) {
  rememberAuthCallbackError(storage, message)
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('clemson-auth-error', { detail: String(message || '').trim() }))
}

export function takeAuthCallbackError(storage) {
  if (!storage) return ''
  try {
    const message = storage.getItem(AUTH_CALLBACK_ERROR_KEY) || ''
    storage.removeItem(AUTH_CALLBACK_ERROR_KEY)
    return String(message).trim()
  } catch {
    return ''
  }
}
