import { supabase } from './supabase.js'
import { authedJson } from './apiClient.js'

export async function api(path, body, options = {}) {
  const method = options.method || (body !== undefined ? 'POST' : 'GET')
  const reqBody = options.body !== undefined ? options.body : body
  return authedJson(supabase, path, {
    ...options,
    method,
    body: reqBody,
  })
}

export function collectTripPayment(body) {
  return api('/api/stripe-payment-methods?action=collect', body)
}

export function createServerScheduledTrip(body) {
  return api('/api/stripe-payment-methods?action=schedule-trip', body)
}

export function createServerDriverTrip(body) {
  return api('/api/stripe-payment-methods?action=request-driver', body)
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
