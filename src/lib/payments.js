import { supabase } from './supabase'

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (!supabase) return headers
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function api(path, body) {
  const headers = await authHeaders()
  let res
  try {
    res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    throw new Error(err?.message || 'Network error')
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    throw new Error(`Payment API failed (HTTP ${res.status})`)
  }
  if (!res.ok) {
    const error = new Error(data?.error || data?.message || `HTTP ${res.status}`)
    error.status = res.status
    error.payload = data
    error.failure = data?.failure || null
    throw error
  }
  return data
}

export function collectTripPayment(body) {
  return api('/api/stripe-payment-methods?action=collect', body)
}

export function settleTrip(body) {
  return api('/api/stripe-payment-methods?action=settle', body)
}

export function fetchCredits() {
  return api('/api/stripe-payment-methods?action=credits')
}

export function buyCredits(tierId) {
  return api('/api/stripe-payment-methods?action=credits', { action: 'buy', tierId, nonce: String(Date.now()) })
}

export function retryDriverPayouts() {
  return api('/api/driver?action=payouts', {})
}

export function fetchDriverPayouts() {
  return api('/api/driver?action=payouts')
}
