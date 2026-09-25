import { supabase } from './supabase.js'
import { authedJson } from './apiClient.js'

export async function api(path, options = {}) {
  return authedJson(supabase, path, options)
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
