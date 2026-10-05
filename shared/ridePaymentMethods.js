/**
 * Payment methods a rider can save for a ride.
 * Stripe names only. Apple Pay and Google Pay are card wallets, not separate
 * PaymentMethod types. Link stays because SetupIntents already use
 * automatic_payment_methods, which includes Link when the Stripe account has it.
 * Buy-now-pay-later, bank transfer, and cash-voucher methods are not offered.
 */

export const ADD_ANOTHER_PAYMENT_METHOD_ID = 'add_another'
export const ADD_ANOTHER_PAYMENT_METHOD_LABEL = 'Add another payment method'

export const RIDE_PAYMENT_METHODS = [
  {
    id: 'card',
    label: 'Card',
    stripeType: 'card',
    wallets: { applePay: 'never', googlePay: 'never' },
  },
  {
    id: 'cashapp',
    label: 'Cash App Pay',
    stripeType: 'cashapp',
    wallets: { applePay: 'never', googlePay: 'never' },
  },
  {
    id: 'apple_pay',
    label: 'Apple Pay',
    stripeType: 'card',
    wallets: { applePay: 'auto', googlePay: 'never' },
  },
  {
    id: 'google_pay',
    label: 'Google Pay',
    stripeType: 'card',
    wallets: { applePay: 'never', googlePay: 'auto' },
  },
  {
    id: 'link',
    label: 'Link',
    stripeType: 'link',
    wallets: { applePay: 'never', googlePay: 'never' },
  },
]

const SETUP_TYPES = ['card', 'cashapp', 'link']

export function ridePaymentMethodById(methodId) {
  return RIDE_PAYMENT_METHODS.find((method) => method.id === methodId) || null
}

export function isWalletPaymentMethod(methodId) {
  return methodId === 'apple_pay' || methodId === 'google_pay'
}

/** SetupIntent / Checkout payment_method_types for this picker choice. */
export function setupPaymentMethodTypes(methodId) {
  if (!methodId || methodId === ADD_ANOTHER_PAYMENT_METHOD_ID) return [...SETUP_TYPES]
  const method = ridePaymentMethodById(methodId)
  if (!method) return [...SETUP_TYPES]
  return [method.stripeType]
}

export function paymentElementWallets(methodId) {
  if (!methodId || methodId === ADD_ANOTHER_PAYMENT_METHOD_ID) {
    return { applePay: 'auto', googlePay: 'auto' }
  }
  return ridePaymentMethodById(methodId)?.wallets || { applePay: 'never', googlePay: 'never' }
}

export function paymentElementOrder(methodId) {
  if (methodId === 'card') return ['card']
  if (methodId === 'cashapp') return ['cashapp']
  if (methodId === 'link') return ['link']
  if (methodId === 'apple_pay') return ['apple_pay', 'card']
  if (methodId === 'google_pay') return ['google_pay', 'card']
  return ['card', 'apple_pay', 'google_pay', 'cashapp', 'link']
}

export function expressCheckoutPaymentMethods(methodId) {
  return {
    applePay: methodId === 'apple_pay' ? 'auto' : 'never',
    googlePay: methodId === 'google_pay' ? 'auto' : 'never',
    link: 'never',
    paypal: 'never',
    amazonPay: 'never',
  }
}

/**
 * Drop a type Stripe rejected when several types were requested together.
 * A single chosen method is not replaced with a different one.
 */
export function narrowSetupPaymentMethodTypes(types, errorMessage) {
  const current = Array.isArray(types) ? types.filter(Boolean) : []
  if (current.length <= 1) return null
  const text = String(errorMessage || '')
  const mentioned = current.filter((type) => new RegExp(`\\b${type}\\b`, 'i').test(text))
  if (!mentioned.length) return null
  const next = current.filter((type) => !mentioned.includes(type))
  if (!next.length || next.join(',') === current.join(',')) return null
  return next
}

export function walletUnavailableCopy(methodId) {
  if (methodId === 'apple_pay') {
    return 'Apple Pay is not available in this browser. Register this domain under Stripe Payment method domains, then open billing on a supported Apple device. No charge was made.'
  }
  if (methodId === 'google_pay') {
    return 'Google Pay is not available in this browser. Open billing on a supported Android device or Chrome with Google Pay set up. No charge was made.'
  }
  return 'That wallet is not available on this device. No charge was made.'
}

/** Checkout return URLs we will send riders back to. Other hosts are dropped. */
export function safeSetupReturnUrl(raw) {
  const value = String(raw || '').trim()
  if (!value) return 'clemsonrides://billing'
  try {
    const url = new URL(value)
    const protocol = url.protocol.toLowerCase()
    const host = url.hostname.toLowerCase()
    if (protocol === 'clemsonrides:' || protocol === 'exp:' || protocol === 'exps:') {
      return `${protocol}//${url.host}${url.pathname}`
    }
    if (protocol === 'https:' && (host === 'clemsonrides.com' || host === 'www.clemsonrides.com')) {
      return `${url.origin}${url.pathname}`
    }
    if ((protocol === 'http:' || protocol === 'https:') && (host === 'localhost' || host === '127.0.0.1')) {
      return `${url.origin}${url.pathname}`
    }
  } catch {
    return 'clemsonrides://billing'
  }
  return 'clemsonrides://billing'
}

export function setupReturnUrls(raw) {
  const root = safeSetupReturnUrl(raw).replace(/[?#].*$/, '')
  return {
    successUrl: `${root}?setup=1&session_id={CHECKOUT_SESSION_ID}&redirect_status=succeeded`,
    cancelUrl: `${root}?redirect_status=canceled`,
  }
}

export function buildSetupIntentParams({ customerId, userId, paymentMethod, types }) {
  return {
    customer: customerId,
    usage: 'off_session',
    payment_method_types: types,
    metadata: {
      profile_id: userId,
      kind: 'save_card',
      ride_method: paymentMethod || ADD_ANOTHER_PAYMENT_METHOD_ID,
    },
  }
}

export function buildSetupCheckoutParams({ customerId, userId, paymentMethod, types, returnUrl }) {
  const { successUrl, cancelUrl } = setupReturnUrls(returnUrl)
  return {
    mode: 'setup',
    customer: customerId,
    payment_method_types: types,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      profile_id: userId,
      kind: 'save_card',
      ride_method: paymentMethod || ADD_ANOTHER_PAYMENT_METHOD_ID,
    },
  }
}
