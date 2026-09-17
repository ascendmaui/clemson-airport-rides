/**
 * Stripe client helpers — airport flat rates in CENTS.
 * GSP 7500 → 25% deposit 1875 · CLT 17500 → 4375
 *
 * Client: VITE_STRIPE_PUBLISHABLE_KEY / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
 * Server: STRIPE_SECRET_KEY (never ship in Vite)
 */

export const AIRPORT_RATES = {
  GSP: {
    code: 'GSP',
    name: 'Greenville-Spartanburg (GSP)',
    fareCents: 7500,
    total: 75,
  },
  CLT: {
    code: 'CLT',
    name: 'Charlotte Douglas (CLT)',
    fareCents: 17500,
    total: 175,
  },
}

export function depositCents(fareCents) {
  return Math.round(Number(fareCents) * 0.25)
}

/** @deprecated prefer depositCents — kept for dollar UI display */
export function depositAmount(totalDollars) {
  return Math.round(totalDollars * 0.25 * 100) / 100
}

export function getStripeConfig() {
  const publishableKey = (
    import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ||
    import.meta.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    ''
  ).trim()
  return {
    publishableKey: publishableKey || null,
    configured: Boolean(publishableKey && publishableKey.startsWith('pk_')),
  }
}

/**
 * Create a checkout / deposit session via Vercel serverless.
 * Falls back to stub when API returns stub or is unreachable.
 */
export async function createCheckoutSession({
  airport,
  riderName,
  successUrl,
  cancelUrl,
}) {
  const rate = AIRPORT_RATES[airport]
  if (!rate) throw new Error('Unknown airport')

  const deposit = depositCents(rate.fareCents)
  const { publishableKey, configured } = getStripeConfig()
  const body = {
    airport: rate.code,
    fareCents: rate.fareCents,
    depositCents: deposit,
    riderName: riderName || 'Rider',
    successUrl:
      successUrl ||
      `${window.location.origin}${window.location.pathname}#/schedule?paid=1`,
    cancelUrl:
      cancelUrl ||
      `${window.location.origin}${window.location.pathname}#/schedule?canceled=1`,
  }

  try {
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (res.ok) return data
    console.warn('[Stripe] checkout API error', data)
  } catch (err) {
    console.warn('[Stripe] checkout API unreachable, stubbing', err)
  }

  return {
    stub: true,
    depositCents: deposit,
    fareCents: rate.fareCents,
    airport: rate.code,
    currency: 'usd',
    publishableKeyConfigured: configured,
    message: configured
      ? 'API stub — set STRIPE_SECRET_KEY on Vercel for live Checkout'
      : 'Set VITE_STRIPE_PUBLISHABLE_KEY + server STRIPE_SECRET_KEY',
  }
}

/** @deprecated use createCheckoutSession */
export async function createDepositIntent({ airport, riderName }) {
  const rate = AIRPORT_RATES[airport]
  if (!rate) throw new Error('Unknown airport')
  const session = await createCheckoutSession({ airport, riderName })
  return {
    stub: Boolean(session.stub),
    clientSecret: session.clientSecret || null,
    deposit: depositAmount(rate.total),
    depositCents: session.depositCents ?? depositCents(rate.fareCents),
    total: rate.total,
    fareCents: rate.fareCents,
    airport: rate.code,
    currency: 'usd',
    url: session.url || null,
    message: session.message,
  }
}
