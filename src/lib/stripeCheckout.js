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
import { quoteFare, AIRPORT_ROUTE_FALLBACK, cardDepositCents, STRIPE_NOT_CONFIGURED_COPY } from './fareRates'
import { supabase } from './supabase'

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
}) {
  const rate = AIRPORT_RATES[airport]
  if (!rate) throw new Error('Unknown airport')

  const headers = { 'Content-Type': 'application/json' }
  if (supabase) {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  }
  const body = {
    airport: rate.code,
    riderName: riderName || 'Rider',
    tripId: tripId || '',
    riderId: riderId || '',
    date: date || undefined,
    time: time || undefined,
    origin: window.location.origin,
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
      headers,
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

  const coveredWithoutCard = res.ok
    && !data?.stub
    && data?.tripId
    && !data?.url
    && (data.paidWithCredits || Number(data.depositCents) === 0)
  if (coveredWithoutCard) return data

  if (!res.ok || data?.stub || !data?.url) {
    const combined = `${data?.message || ''} ${data?.error || ''}`
    const msg = /not configured|payments unavailable/i.test(combined)
      ? STRIPE_NOT_CONFIGURED_COPY
      : (
        data?.message ||
        data?.error ||
        (res.status === 503
          ? STRIPE_NOT_CONFIGURED_COPY
          : `Checkout failed (HTTP ${res.status})`)
      )
    const err = new Error(msg)
    err.status = res.status
    err.payload = data
    throw err
  }

  return data
}

/** Tell the server a Checkout was canceled so an unpaid searching trip leaves the pool. */
export async function abandonCheckoutSession({ tripId, sessionId } = {}) {
  if (!tripId) throw new Error('Missing trip')
  const headers = { 'Content-Type': 'application/json' }
  if (supabase) {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  }
  let res
  try {
    res = await fetch('/api/stripe-payment-methods?action=abandon-checkout', {
      method: 'POST',
      headers,
      body: JSON.stringify({ tripId, sessionId: sessionId || undefined }),
    })
  } catch (err) {
    throw new Error(err?.message || 'Could not close checkout')
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    throw new Error(`Could not close checkout (HTTP ${res.status})`)
  }
  if (!res.ok) {
    const error = new Error(data?.error || data?.message || `Could not close checkout (HTTP ${res.status})`)
    error.status = res.status
    error.payload = data
    throw error
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
