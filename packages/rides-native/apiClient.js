/** Calls the existing Vercel /api routers. No new functions and no secret keys. */

const DEFAULT_API = 'https://clemson-airport-rides.vercel.app'

export function apiBase() {
  const raw = process.env.EXPO_PUBLIC_API_BASE || DEFAULT_API
  return String(raw).replace(/\/$/, '')
}

export async function authedJson(supabase, path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (supabase) {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  }
  const url = path.startsWith('http') ? path : `${apiBase()}${path}`
  let res
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    const error = new Error(err?.message || 'Network error')
    error.network = true
    throw error
  }
  const text = await res.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    const error = new Error('API unavailable')
    error.unavailable = true
    error.status = res.status
    throw error
  }
  if (!res.ok) {
    const error = new Error(data.error || data.message || `HTTP ${res.status}`)
    error.status = res.status
    error.payload = data
    error.failure = data.failure || null
    if (res.status === 404 || res.status === 503) error.unavailable = true
    throw error
  }
  return data
}
