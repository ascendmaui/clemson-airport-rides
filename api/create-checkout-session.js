/**
 * Vercel serverless — POST /api/create-checkout-session
 * GSP 7500 → 1875 · CLT 17500 → 4375
 * Missing STRIPE_SECRET_KEY → 503 JSON error (never stub success)
 */
import Stripe from 'stripe'
import { splitPlatformFee, feeMetadata } from '../src/lib/fareRates.js'

const stripeSecret = process.env.STRIPE_SECRET_KEY || ''
const DEFAULT_FARES = { GSP: 7500, CLT: 17500 }

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.end(JSON.stringify(body))
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { return json(res, 400, { error: 'Invalid JSON' }) }
  }
  body = body || {}

  const airport = String(body.airport || 'GSP').toUpperCase()
  const fareCents = Number(body.fareCents) || DEFAULT_FARES[airport] || 7500
  const depositCents = Number(body.depositCents) || Math.round(fareCents * 0.25)
  const riderName = body.riderName || 'Rider'
  const tripId = body.tripId || ''
  const riderId = body.riderId || ''
  const successUrl = body.successUrl || 'https://clemson-airport-rides.vercel.app/#/schedule?paid=1'
  const cancelUrl = body.cancelUrl || 'https://clemson-airport-rides.vercel.app/#/schedule?canceled=1'

  if (!stripeSecret || !stripeSecret.startsWith('sk_') || stripeSecret.includes('placeholder')) {
    return json(res, 503, {
      error: 'Payments unavailable',
      message: 'STRIPE_SECRET_KEY is not configured. Checkout cannot start.',
      airport,
      fareCents,
      depositCents,
      currency: 'usd',
    })
  }

  try {
    const stripe = new Stripe(stripeSecret)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: depositCents,
          product_data: {
            name: `Clemson RIDES ${airport} deposit (25%)`,
            description: `${riderName} · fare $${(fareCents / 100).toFixed(2)} · deposit $${(depositCents / 100).toFixed(2)}`,
          },
        },
      }],
      metadata: feeMetadata(depositCents, {
        airport,
        fareCents,
        depositCents,
        riderName,
        kind: 'airport_deposit',
        tripId: tripId || '',
        riderId: riderId || '',
        fare_platform_fee_cents: splitPlatformFee(fareCents).platformFeeCents,
        fare_driver_earnings_cents: splitPlatformFee(fareCents).driverEarningsCents,
      }),
    })
    return json(res, 200, {
      id: session.id,
      url: session.url,
      airport,
      fareCents,
      depositCents,
      currency: 'usd',
    })
  } catch (err) {
    console.error('[create-checkout-session]', err)
    return json(res, 500, {
      error: err.message || 'Stripe error',
      message: 'Stripe Checkout Session create failed',
      airport,
      fareCents,
      depositCents,
    })
  }
}
