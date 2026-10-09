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

export const NATIVE_SHEET_MERCHANT_NAME = 'Clemson RIDES'
export const NATIVE_SHEET_RETURN_URL = 'clemsonrides://billing'

const SAVED_METHOD_TYPES = ['card', 'cashapp', 'link']

export function googlePayTestEnv(publishableKey) {
  return !String(publishableKey || '').startsWith('pk_live_')
}

/**
 * PaymentSheet options for a SetupIntent. Apple Pay and Google Pay stay card
 * wallets. Cash App Pay and Link use the Stripe types the server already sends.
 * This does not create a charge.
 */
export function nativeSetupSheetParams(methodId, { testEnv = true } = {}) {
  const types = setupPaymentMethodTypes(methodId)
  const wallets = paymentElementWallets(methodId)
  const params = {
    merchantDisplayName: NATIVE_SHEET_MERCHANT_NAME,
    returnURL: NATIVE_SHEET_RETURN_URL,
    primaryButtonLabel: 'Save payment method',
    allowsDelayedPaymentMethods: types.includes('cashapp'),
    paymentMethodOrder: paymentElementOrder(methodId).filter((type) => SAVED_METHOD_TYPES.includes(type)),
    link: { display: types.includes('link') ? 'automatic' : 'never' },
  }
  if (wallets.applePay === 'auto') params.applePay = { merchantCountryCode: 'US' }
  if (wallets.googlePay === 'auto') {
    params.googlePay = {
      merchantCountryCode: 'US',
      currencyCode: 'USD',
      testEnv: testEnv !== false,
    }
  }
  return params
}

export function nativeWalletUnavailableCopy(methodId) {
  if (methodId === 'apple_pay') {
    return 'Apple Pay needs the Apple merchant ID on this build. No charge was made.'
  }
  if (methodId === 'google_pay') {
    return 'Google Pay is not available on this phone. No charge was made.'
  }
  return 'That payment method is not available on this phone. No charge was made.'
}

export function readPublicStripeConfig(env = process.env) {
  const source = env || {}
  const publishableKey = [
    source.STRIPE_PUBLISHABLE_KEY,
    source.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    source.VITE_STRIPE_PUBLISHABLE_KEY,
    source.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  ].map((value) => String(value || '').trim()).find((value) => value.startsWith('pk_') && !/placeholder/i.test(value)) || null
  const merchantIdentifier = String(
    source.STRIPE_MERCHANT_IDENTIFIER || source.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER || '',
  ).trim()
  return {
    publishableKey,
    merchantIdentifier: /^merchant\./.test(merchantIdentifier) ? merchantIdentifier : null,
  }
}

export function summarizeSavedPaymentMethod(pm) {
  if (!pm?.id) return null
  if (pm.type === 'cashapp') {
    return {
      id: pm.id,
      type: 'cashapp',
      brand: 'Cash App',
      last4: null,
      cashtag: pm.cashapp?.cashtag || null,
    }
  }
  if (pm.type === 'link') {
    return {
      id: pm.id,
      type: 'link',
      brand: 'Link',
      last4: null,
      email: pm.link?.email || null,
    }
  }
  if (pm.type === 'card' || pm.card) {
    return {
      id: pm.id,
      type: 'card',
      brand: pm.card?.brand || 'card',
      last4: pm.card?.last4 || null,
    }
  }
  return null
}

export function savedPaymentMethodLabel(method) {
  if (!method) return 'Saved method'
  if (method.cashtag) return `Cash App ${method.cashtag}`
  if (method.type === 'link') return method.email ? `Link · ${method.email}` : 'Link'
  if (method.type === 'cashapp') return 'Cash App Pay'
  const brand = String(method.brand || 'Card')
  if (method.last4) return `${brand.toUpperCase()} ···· ${method.last4}`
  return brand
}

/** List the SetupIntent types this account can save. A disabled wallet type is skipped. */
export async function listCustomerPaymentMethods(stripe, customerId) {
  if (!stripe || !customerId) return []
  const methods = []
  for (const type of SAVED_METHOD_TYPES) {
    try {
      const listed = await stripe.paymentMethods.list({ customer: customerId, type, limit: 20 })
      for (const pm of listed?.data || []) {
        const row = summarizeSavedPaymentMethod(pm)
        if (row) methods.push(row)
      }
    } catch (err) {
      const message = String(err?.message || err?.raw?.message || '')
      if (type !== 'card' && /payment method type|invalid|unknown type|not enabled|unrecognized/i.test(message)) continue
      throw err
    }
  }
  return methods
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
