/**
 * Vercel serverless — POST /api/stripe-webhook
 */
import Stripe from 'stripe'

export const config = { api: { bodyParser: false } }

const stripeSecret = process.env.STRIPE_SECRET_KEY || ''
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  if (req.method !== 'POST') {
    res.statusCode = 405
    return res.end(JSON.stringify({ error: 'Method not allowed' }))
  }

  if (!stripeSecret || !stripeSecret.startsWith('sk_')) {
    res.statusCode = 200
    return res.end(JSON.stringify({
      stub: true,
      message: 'STRIPE_SECRET_KEY not set — webhook stub acknowledged',
    }))
  }

  try {
    const stripe = new Stripe(stripeSecret)
    const rawBody = await readRawBody(req)
    let event
    if (webhookSecret) {
      const sig = req.headers['stripe-signature']
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
    } else {
      event = JSON.parse(rawBody.toString('utf8'))
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object
      console.log('[stripe-webhook] checkout.session.completed', {
        id: session?.id,
        metadata: session?.metadata,
        amount_total: session?.amount_total,
      })
    } else if (event.type === 'payment_intent.succeeded') {
      console.log('[stripe-webhook] payment_intent.succeeded', event.data?.object?.id)
    } else {
      console.log('[stripe-webhook] unhandled', event.type)
    }

    res.statusCode = 200
    return res.end(JSON.stringify({ received: true, type: event.type }))
  } catch (err) {
    console.error('[stripe-webhook]', err)
    res.statusCode = 400
    return res.end(JSON.stringify({ error: err.message || 'Webhook error' }))
  }
}
