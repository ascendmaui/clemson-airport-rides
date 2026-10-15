/**
 * Promo code admin calls. Driver app only; never import from the rider app.
 * Every call is 403 unless the server says this is the promo admin.
 */
import { authedJson } from './apiClient.js'

export function loadPromoAdmin(supabase, fetchImpl) {
  return authedJson(supabase, '/api/admin?action=promo-codes', { fetch: fetchImpl })
}

export function createPromoCodes(supabase, input, fetchImpl) {
  return authedJson(supabase, '/api/admin?action=promo-create', { method: 'POST', body: input, fetch: fetchImpl })
}

export function updatePromoCode(supabase, id, patch, fetchImpl) {
  return authedJson(supabase, '/api/admin?action=promo-update', { method: 'POST', body: { id, patch }, fetch: fetchImpl })
}

export function exportPromoCodes(supabase, { campaign } = {}, fetchImpl) {
  const q = campaign ? `&campaign=${encodeURIComponent(campaign)}` : ''
  return authedJson(supabase, `/api/admin?action=promo-export&format=json${q}`, { fetch: fetchImpl })
}
