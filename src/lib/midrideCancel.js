import { supabase } from './supabase.js'
import { authedJson } from './apiClient.js'

export {
  formatMidrideMoney,
  isPaymentRequired,
  midrideChargeSummary,
  paymentRequiredMessage,
} from '../../shared/midrideQuote.js'

export async function requestMidrideCancel({ tripId, confirm = false }, options = {}) {
  return authedJson(supabase, '/api/driver?action=cancel-midride', {
    method: 'POST',
    body: { tripId, confirm },
    fetch: options?.fetch,
    headers: options?.headers,
  })
}
