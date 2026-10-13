/**
 * Driver payout methods desk. Cash-out reuses the instant cash-out API
 * with an explicit instant or standard method.
 */
import { authedJson } from './apiClient.js'

export async function loadPayoutDesk(supabase) {
  return authedJson(supabase, '/api/driver?action=payout-methods')
}

export async function startPayoutSetup(supabase) {
  return authedJson(supabase, '/api/driver?action=payout-methods', {
    method: 'POST',
    body: { op: 'setup' },
  })
}

export async function cashOutPayout(supabase, { method, feeCents }) {
  return authedJson(supabase, '/api/driver?action=payout-methods', {
    method: 'POST',
    body: { op: 'cashout', confirm: true, method, feeCents },
  })
}
