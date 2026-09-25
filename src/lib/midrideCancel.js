import { supabase } from './supabase.js'
import { authedJson } from './apiClient.js'
import { formatUsdFromCents } from './pricing.js'

export async function requestMidrideCancel({ tripId, confirm = false }, options = {}) {
  return authedJson(supabase, '/api/driver?action=cancel-midride', {
    method: 'POST',
    body: { tripId, confirm },
    fetch: options?.fetch,
    headers: options?.headers,
  })
}

export function formatMidrideMoney(cents) {
  return formatUsdFromCents(cents || 0)
}

export function isPaymentRequired(quote) {
  const status = quote?.paymentStatus
  return status === 'payment_required'
    || status === 'failed'
    || status === 'requires_payment_method'
}

export function paymentRequiredMessage(quote) {
  if (!isPaymentRequired(quote)) return null
  // 0 means nothing is left to charge. `||` treated that as missing and quoted the full obligation.
  const amount = formatMidrideMoney(quote.toCollectCents ?? quote.obligationCents)
  return `Payment required. The ride has ended, but ${amount} still needs a card.`
}

export function midrideChargeSummary(quote) {
  if (!quote) return ''
  const total = formatMidrideMoney(quote.obligationCents)
  const fee = formatMidrideMoney(quote.cancelFeeCents)
  const ride = formatMidrideMoney(quote.ridePortionCents)
  const now = formatMidrideMoney(quote.toCollectCents)
  if ((quote.depositPaidCents || 0) > 0 && (quote.toCollectCents || 0) === 0) {
    return `${total} trip charge (${ride} so far + ${fee} cancel fee). Your deposit covers it — no extra card charge.`
  }
  if ((quote.depositPaidCents || 0) > 0) {
    return `${total} trip charge (${ride} so far + ${fee} cancel fee). Card charge now ${now} after your deposit.`
  }
  return `${total} (${ride} for distance and time so far + ${fee} cancel fee).`
}
