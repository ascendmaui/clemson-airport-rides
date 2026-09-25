import { friendlyApiError } from './apiErrors.js'

/**
 * Authed JSON client for web.
 * Supports:
 * - authedJson(supabaseClient, path, options)
 * - authedJson(path, options)
 *
 * Automatically attaches Supabase session Bearer token if client has auth.getSession.
 * On HTTP 401, calls client.auth.refreshSession() ONCE and retries the request once.
 * On 503 or config errors, sanitizes error message via friendlyApiError.
 */
export async function authedJson(supabaseOrPath, pathOrOptions, maybeOptions) {
  let client
  let path
  let options

  if (typeof supabaseOrPath === 'string') {
    path = supabaseOrPath
    options = pathOrOptions || {}
    client = options.supabase || null
  } else {
    options = maybeOptions || {}
    client = options.supabase || supabaseOrPath || null
    path = pathOrOptions
  }

  const fetcher = options.fetch || globalThis.fetch
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers || {}),
  }

  if (typeof client?.auth?.getSession === 'function') {
    try {
      const sessionResult = await client.auth.getSession()
      const token =
        sessionResult?.data?.session?.access_token ??
        sessionResult?.session?.access_token
      if (token && !headers.Authorization) {
        headers.Authorization = `Bearer ${token}`
      }
    } catch {
      // Continue without token
    }
  }

  const url = path
  const method = options.method || 'GET'
  const reqBody =
    options.body == null
      ? undefined
      : typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body)

  let res
  try {
    res = await fetcher(url, {
      method,
      headers: { ...headers },
      body: reqBody,
    })
  } catch (err) {
    const error = new Error(err?.message || 'Network error')
    error.network = true
    throw error
  }

  // On 401, call supabase.auth.refreshSession() ONCE.
  // If it yields a session, retry the request once with the new access token.
  if (res.status === 401 && typeof client?.auth?.refreshSession === 'function') {
    let refreshedSession = null
    try {
      const refreshResult = await client.auth.refreshSession()
      refreshedSession =
        refreshResult?.data?.session ?? refreshResult?.session ?? null
    } catch {
      refreshedSession = null
    }

    const nextToken = refreshedSession?.access_token
    if (nextToken) {
      headers.Authorization = `Bearer ${nextToken}`
      try {
        res = await fetcher(url, {
          method,
          headers: { ...headers },
          body: reqBody,
        })
      } catch (err) {
        const error = new Error(err?.message || 'Network error')
        error.network = true
        throw error
      }
    }
  }

  let text = ''
  if (typeof res.text === 'function') {
    text = await res.text()
  } else if (typeof res.json === 'function') {
    const j = await res.json()
    text = typeof j === 'string' ? j : JSON.stringify(j)
  }

  let data = {}
  let parseFailed = false
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    parseFailed = true
    data = text
  }

  if (!res.ok) {
    const friendly = friendlyApiError(res.status, data)
    const error = new Error(friendly.message)
    error.status = res.status
    const code =
      typeof data === 'object' && data !== null
        ? (data.code ??
          data.error_code ??
          (typeof data.error === 'string' ? data.error : undefined))
        : undefined
    if (code !== undefined) error.code = code
    error.kind = friendly.kind
    error.payload =
      typeof data === 'object' && data !== null
        ? data
        : { message: String(text || '') }
    error.failure =
      typeof data === 'object' && data !== null ? (data.failure || null) : null

    if (
      res.status === 404 ||
      res.status === 503 ||
      friendly.kind === 'unavailable'
    ) {
      error.unavailable = true
    }
    if (res.status === 401 || friendly.kind === 'auth') {
      error.auth = true
    }
    throw error
  }

  if (parseFailed) {
    const error = new Error('API unavailable')
    error.unavailable = true
    error.status = res.status
    throw error
  }

  return data
}

export const authedFetch = authedJson
