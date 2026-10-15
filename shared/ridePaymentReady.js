/**
 * A saved payment method is required before a rider can request a ride.
 * Apple Pay counts when it is saved as a wallet or the device reports it is set up.
 * This does not change the pre-auth hold. The hold still runs after the request is accepted.
 */

export const PAYMENT_METHOD_REQUIRED = 'payment_method_required'

export const PAYMENT_METHOD_REQUIRED_MESSAGE =
  'Add a payment method before requesting a ride. A saved card or Apple Pay is required.'

export function applePayBrand(value) {
  const brand = String(value || '').toLowerCase().replace(/[\s-]+/g, '_')
  return brand === 'apple_pay' || brand === 'applepay' || brand.includes('apple_pay')
}

/**
 * Ready when a default payment method is saved, the saved brand is Apple Pay,
 * or the caller confirmed Apple Pay is set up on the device.
 */
export function riderPaymentMethodReady(profile, { applePay = false } = {}) {
  if (profile && profile.stripe_default_pm_id) return { ok: true, source: 'default' }
  if (applePayBrand(profile?.stripe_card_brand) || applePayBrand(profile?.wallet)) {
    return { ok: true, source: 'apple_pay' }
  }
  if (applePay === true) return { ok: true, source: 'apple_pay' }
  return { ok: false, source: null }
}

export function paymentMethodRequiredError(err) {
  return err?.code === PAYMENT_METHOD_REQUIRED
}
