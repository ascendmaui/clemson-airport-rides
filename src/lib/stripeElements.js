import { getStripeConfig } from './stripeCheckout'

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
