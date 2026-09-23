import { supabase } from './supabase'

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (!supabase) return headers
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = await authHeaders()
  const res = await fetch(path, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { data = null }
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `HTTP ${res.status}`)
    err.payload = data
    throw err
  }
  return data
}

export function fetchCredits() {
  return api('/api/stripe-payment-methods?action=credit-lots')
}

export function buyCreditPack(packId) {
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined
  return api('/api/stripe-payment-methods?action=buy-credits', { method: 'POST', body: { packId, origin } })
}

export function confirmCreditPurchase(sessionId) {
  return api('/api/stripe-payment-methods?action=credits-confirm', { method: 'POST', body: { sessionId } })
}

export function startAirportCheckout(body) {
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined
  return api('/api/stripe-payment-methods?action=airport-checkout', { method: 'POST', body: { ...body, origin } })
}
