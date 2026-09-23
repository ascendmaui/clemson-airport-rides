import { supabase } from './supabase'

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (!supabase) return headers
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

/**
 * Server transition for the pickup wait clock.
 * @param {'arrive'|'tick'|'cancel'|'start'|'complete'} action
 */
export async function tripWaitAction(action, tripId) {
  const headers = await authHeaders()
  let res
  try {
    res = await fetch('/api/trip-wait', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, tripId }),
    })
  } catch (e) {
    throw new Error(e?.message || 'Network error')
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    throw new Error(`Wait update failed (HTTP ${res.status})`)
  }
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `HTTP ${res.status}`)
    err.status = res.status
    err.payload = data
    throw err
  }
  return data
}
