/**
 * Stripe client helpers.
 * Airport amounts are the unsurged, non-student fallback quote from the
 * UberX Greenville–Spartanburg card in src/lib/fareRates.js (not the old
 * $75 / $175 flats). Live checkout uses /api/airport-checkout, which adds
 * surge, the student discount, and prepaid credits.
 *
 * Client: VITE_STRIPE_PUBLISHABLE_KEY
 * Server: STRIPE_SECRET_KEY (never ship in Vite)
 */
import { quoteFare, AIRPORT_ROUTE_FALLBACK } from './fareRates'

function fallbackFareCents(code) {
  const route = AIRPORT_ROUTE_FALLBACK[code]
  return quoteFare({ miles: route.miles, minutes: route.minutes }).fareBeforeCreditsCents
}

export const AIRPORT_RATES = {
  GSP: {
    code: 'GSP',
    name: 'Greenville-Spartanburg (GSP)',
    fareCents: fallbackFareCents('GSP'),
    total: fallbackFareCents('GSP') / 100,
  },
  CLT: {
    code: 'CLT',
    name: 'Charlotte Douglas (CLT)',
    fareCents: fallbackFareCents('CLT'),
    total: fallbackFareCents('CLT') / 100,
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
 * Create a Checkout Session via Vercel serverless.
 * Never pretends paid: missing URL / stub / non-OK → throws with honest error.
 */
export async function createCheckoutSession({
  airport,
  riderName,
  successUrl,
  cancelUrl,
  tripId,
  riderId,
  fareCents,
  depositCents: depositOverride,
}) {
  const rate = AIRPORT_RATES[airport]
  if (!rate) throw new Error('Unknown airport')

  const fare = fareCents ?? rate.fareCents
  const deposit = depositOverride ?? depositCents(fare)
  const body = {
    airport: rate.code,
    fareCents: fare,
    depositCents: deposit,
    riderName: riderName || 'Rider',
    tripId: tripId || '',
    riderId: riderId || '',
    successUrl:
      successUrl ||
      `${window.location.origin}${window.location.pathname}#/schedule?paid=1`,
    cancelUrl:
      cancelUrl ||
      `${window.location.origin}${window.location.pathname}#/schedule?canceled=1`,
  }

  let res
  try {
    res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(
      err?.message
        ? `Checkout unreachable: ${err.message}`
        : 'Checkout API unreachable — try again shortly.',
    )
  }

  let data = null
  try {
    data = await res.json()
  } catch {
    throw new Error(`Checkout failed (HTTP ${res.status})`)
  }

  if (!res.ok || data?.stub || !data?.url) {
    const msg =
      data?.error ||
      data?.message ||
      (res.status === 503
        ? 'Payments are temporarily unavailable (Stripe not configured).'
        : `Checkout failed (HTTP ${res.status})`)
    const err = new Error(msg)
    err.status = res.status
    err.payload = data
    throw err
  }

  return data
}

/** @deprecated use createCheckoutSession */
export async function createDepositIntent({ airport, riderName }) {
  const rate = AIRPORT_RATES[airport]
  if (!rate) throw new Error('Unknown airport')
  const session = await createCheckoutSession({ airport, riderName })
  return {
    stub: false,
    clientSecret: session.clientSecret || null,
    deposit: depositAmount(rate.total),
    depositCents: session.depositCents ?? depositCents(rate.fareCents),
    total: rate.total,
    fareCents: rate.fareCents,
    airport: rate.code,
    currency: 'usd',
    url: session.url,
    message: session.message,
  }
}
