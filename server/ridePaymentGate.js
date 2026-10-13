import {
  PAYMENT_METHOD_REQUIRED,
  PAYMENT_METHOD_REQUIRED_MESSAGE,
  riderPaymentMethodReady,
} from '../shared/ridePaymentReady.js'

function applePayFromBody(body) {
  if (!body || typeof body !== 'object') return false
  if (body.applePay === true || body.apple_pay === true) return true
  const wallet = String(body.paymentMethod || body.payment_method || body.wallet || '').toLowerCase()
  return wallet === 'apple_pay'
}

/**
 * Reject a ride request that has no saved card and no Apple Pay.
 * A lookup failure is not treated as "no card".
 */
export async function assertRiderPaymentMethod(sb, riderId, body = {}) {
  const columns = ['stripe_default_pm_id, stripe_card_brand', 'stripe_default_pm_id']
  let profile = null
  let lastError = null
  for (const cols of columns) {
    const res = await sb.from('profiles').select(cols).eq('id', riderId).maybeSingle()
    if (!res?.error) {
      profile = res.data || null
      lastError = null
      break
    }
    lastError = res.error
    if (!/column|schema cache/i.test(res.error.message || '')) break
  }
  if (lastError) {
    return {
      ok: false,
      status: 503,
      code: 'payment_method_lookup_failed',
      error: 'Could not check the payment method on file. Try again.',
    }
  }
  const ready = riderPaymentMethodReady(profile, { applePay: applePayFromBody(body) })
  if (ready.ok) return { ok: true, source: ready.source }
  return {
    ok: false,
    status: 402,
    code: PAYMENT_METHOD_REQUIRED,
    error: PAYMENT_METHOD_REQUIRED_MESSAGE,
  }
}
