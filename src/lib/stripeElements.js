import { getStripeConfig } from './stripeCheckout'

export const PAYMENT_ELEMENT_APPEARANCE = {
  theme: 'stripe',
  variables: {
    colorPrimary: '#F56600',
    colorText: '#0B1220',
    borderRadius: '12px',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
}

let stripePromise = null

export async function loadStripeJs() {
  const { publishableKey, configured } = getStripeConfig()
  if (!configured) {
    throw new Error('VITE_STRIPE_PUBLISHABLE_KEY is not set — cannot show card / Apple Pay form.')
  }
  if (!stripePromise) {
    const mod = await import('@stripe/stripe-js')
    stripePromise = mod.loadStripe(publishableKey)
  }
  return stripePromise
}
