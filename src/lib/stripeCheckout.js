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
import { quoteFare, AIRPORT_ROUTE_FALLBACK, cardDepositCents, STRIPE_NOT_CONFIGURED_COPY } from './fareRates.js'
import { supabase } from './supabase.js'
import { authedJson } from './apiClient.js'
import { friendlyApiError } from './apiErrors.js'

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
  return cardDepositCents(fareCents)
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
  date,
  time,
}, options = {}) {
  const rate = AIRPORT_RATES[airport]
  if (!rate) throw new Error('Unknown airport')

  const origin = typeof window !== 'undefined' ? window.location?.origin : undefined
  const pathname = typeof window !== 'undefined' ? (window.location?.pathname || '') : ''
  const body = {
    airport: rate.code,
    riderName: riderName || 'Rider',
    tripId: tripId || '',
    riderId: riderId || '',
    date: date || undefined,
    time: time || undefined,
    origin,
    successUrl:
      successUrl ||
      (origin ? `${origin}${pathname}#/schedule?paid=1` : undefined),
    cancelUrl:
      cancelUrl ||
      (origin ? `${origin}${pathname}#/schedule?canceled=1` : undefined),
  }

  const client = options?.supabase || supabase
  const data = await authedJson(client, '/api/create-checkout-session', {
    method: 'POST',
    body,
    fetch: options.fetch,
    headers: options.headers,
    supabase: client,
  })

  const coveredWithoutCard =
    !data?.stub &&
    data?.tripId &&
    !data?.url &&
    (data.paidWithCredits || Number(data.depositCents) === 0)
  if (coveredWithoutCard) return data

  if (data?.stub || !data?.url) {
    const friendly = friendlyApiError(503, data)
    const err = new Error(friendly.message)
    err.status = 503
    err.kind = friendly.kind
    err.unavailable = true
    err.payload = data
    throw err
  }

  return data
}

/** Tell the server a Checkout was canceled so an unpaid searching trip leaves the pool. */
export async function abandonCheckoutSession({ tripId, sessionId } = {}, options = {}) {
  if (!tripId) throw new Error('Missing trip')
  const client = options?.supabase || supabase
  return authedJson(client, '/api/stripe-payment-methods?action=abandon-checkout', {
    method: 'POST',
    body: { tripId, sessionId: sessionId || undefined },
    fetch: options?.fetch,
    headers: options?.headers,
    supabase: client,
  })
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
