/**
 * Vercel serverless — POST /api/create-checkout-session
 * GSP 7500 → 1875 · CLT 17500 → 4375
 * Missing STRIPE_SECRET_KEY → 200 { stub: true, message }
 */
import Stripe from 'stripe'

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
    return json(res, 200, {
      stub: true,
      airport,
      fareCents,
      depositCents,
      currency: 'usd',
      message: 'STRIPE_SECRET_KEY not set — stub checkout. Deposit calculated; no charge created.',
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
      metadata: {
        airport,
        fareCents: String(fareCents),
        depositCents: String(depositCents),
        riderName,
        kind: 'airport_deposit',
        tripId: String(tripId || ''),
        riderId: String(riderId || ''),
      },
    })
    return json(res, 200, {
      stub: false,
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
      stub: true,
      airport,
      fareCents,
      depositCents,
      message: 'Stripe call failed — returning stub shape',
    })
  }
}
