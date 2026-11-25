import { authedJson } from './apiClient.js'

const PATH = '/api/driver?action=payout-approvals'

/** Approver queue. Throws with status 403 for anyone but the payout approver. */
export function loadPayoutApprovalQueue(supabase, fetchImpl) {
  return authedJson(supabase, `${PATH}&scope=admin`, { fetch: fetchImpl })
}

export function decidePayoutApproval(supabase, { id, decision, reason, fetch: fetchImpl } = {}) {
  return authedJson(supabase, PATH, { method: 'POST', body: { id, decision, reason: reason || undefined }, fetch: fetchImpl })
}
