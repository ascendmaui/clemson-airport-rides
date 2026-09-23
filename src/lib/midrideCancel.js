import { supabase } from './supabase'
import { formatUsdFromCents } from './pricing'

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (!supabase) return headers
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function requestMidrideCancel({ tripId, confirm = false }) {
  const headers = await authHeaders()
  let res
  try {
    res = await fetch('/api/trip-cancel-midride', {
      method: 'POST',
      headers,
      body: JSON.stringify({ tripId, confirm }),
    })
  } catch (err) {
    throw new Error(err?.message || 'Network error')
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    throw new Error(`Mid-ride cancel failed (HTTP ${res.status})`)
  }
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `HTTP ${res.status}`)
    err.status = res.status
    err.payload = data
    throw err
  }
  return data
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
  const amount = formatMidrideMoney(quote.toCollectCents || quote.obligationCents)
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
