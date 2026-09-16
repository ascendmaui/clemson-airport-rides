/**
 * Stripe deposit stub — drop-in client shape for Phase A.
 *
 * Airport flat rates: GSP $75 · CLT $175 · 25% deposit.
 *
 * Client needs only VITE_STRIPE_PUBLISHABLE_KEY.
 * The Stripe secret key (sk_…) MUST stay server-side — never ship it in Vite.
 *
 * Required env for a real PaymentIntent:
 *   Client: VITE_STRIPE_PUBLISHABLE_KEY (pk_test_… / pk_live_…)
 *   Server: STRIPE_SECRET_KEY (sk_…) + POST /api/stripe/create-deposit-intent
 */

export const AIRPORT_RATES = {
  GSP: { code: 'GSP', name: 'Greenville-Spartanburg (GSP)', total: 75 },
  CLT: { code: 'CLT', name: 'Charlotte Douglas (CLT)', total: 175 },
}

/**
 * Read publishable Stripe config from Vite env.
 * Returns { publishableKey, configured } — never invents secrets.
 */
export function getStripeConfig() {
  const publishableKey = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim()
  return {
    publishableKey: publishableKey || null,
    configured: Boolean(publishableKey && publishableKey.startsWith('pk_')),
  }
}

export function depositAmount(total) {
  return Math.round(total * 0.25 * 100) / 100
}

/**
 * Stub deposit intent. Does not call Stripe.
 *
 * When wiring live:
 *   1. Server: STRIPE_SECRET_KEY + create PaymentIntent for `deposit` (cents)
 *   2. Client: getStripeConfig().publishableKey + Stripe.js Payment Element
 *   3. Replace this body with POST /api/stripe/create-deposit-intent
 *
 * Returns a stub-shaped intent (no fake client secrets that look real).
 */
export async function createDepositIntent({ airport, riderName }) {
  const rate = AIRPORT_RATES[airport]
  if (!rate) throw new Error('Unknown airport')

  const deposit = depositAmount(rate.total)
  const { publishableKey, configured } = getStripeConfig()

  // Stub only — no network, no fabricated secret keys
  console.log('[Stripe stub] createDepositIntent', {
    airport,
    riderName,
    total: rate.total,
    deposit,
    currency: 'usd',
    publishableKeyConfigured: configured,
    publishableKeyPrefix: publishableKey ? `${publishableKey.slice(0, 7)}…` : null,
  })

  return {
    stub: true,
    // Placeholder — not a valid Stripe secret; UI must not treat as live
    clientSecret: null,
    deposit,
    total: rate.total,
    airport: rate.code,
    currency: 'usd',
    message: configured
      ? 'Publishable key present — wire Payment Element + server intent next'
      : 'Set VITE_STRIPE_PUBLISHABLE_KEY; server secret stays server-side',
  }
}
