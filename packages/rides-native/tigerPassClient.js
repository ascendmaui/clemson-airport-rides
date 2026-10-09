import { authedJson } from './apiClient.js'
import { TIGER_PASS_NAME, tigerPassCopy } from '../../shared/tigerPass.js'

export { TIGER_PASS_NAME, tigerPassCopy }

const PASS_PATH = '/api/stripe-payment-methods?action=tiger-pass'
const FAVORITE_PATH = '/api/stripe-payment-methods?action=favorite-drivers'

export function loadTigerPass(supabase) {
  return authedJson(supabase, PASS_PATH, { method: 'POST', body: { op: 'status' } })
}

export function saveTigerPassPreferences(supabase, { preferredDriverIds, preferredCarTypes }) {
  return authedJson(supabase, PASS_PATH, {
    method: 'POST',
    body: { op: 'preferences', preferredDriverIds, preferredCarTypes },
  })
}

export function startTigerPassCheckout(supabase, body = {}) {
  return authedJson(supabase, PASS_PATH, { method: 'POST', body: { op: 'checkout', ...body } })
}

export function confirmTigerPass(supabase, sessionId) {
  return authedJson(supabase, PASS_PATH, { method: 'POST', body: { op: 'confirm', sessionId } })
}

export function cancelTigerPass(supabase) {
  return authedJson(supabase, PASS_PATH, { method: 'POST', body: { op: 'cancel' } })
}

export function setFavoriteDrivers(supabase, driverIds) {
  return authedJson(supabase, FAVORITE_PATH, { method: 'POST', body: { op: 'set', driverIds } })
}
