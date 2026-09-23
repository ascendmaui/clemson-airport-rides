/**
 * Vercel serverless — POST /api/stripe-webhook
 * Records 25% deposits into public.payments when SUPABASE_SERVICE_ROLE_KEY is set.
 */
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { setPaymentHold } from '../server/collectPayment.js'
import { classifyStripeError, failureResult } from '../shared/paymentFailure.js'

export const config = { api: { bodyParser: false } }

const stripeSecret = process.env.STRIPE_SECRET_KEY || ''
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''
const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://awktabuhijrshmsmagpq.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function recordDeposit(session) {
  if (!serviceKey) {
    console.warn('[stripe-webhook] SUPABASE_SERVICE_ROLE_KEY missing — skip payments insert')
    return { skipped: true, reason: 'no_service_role' }
  }
  const tripId = session?.metadata?.tripId
  const riderId = session?.metadata?.riderId
  if (!tripId || !riderId) {
    console.warn('[stripe-webhook] missing metadata.tripId/riderId — skip insert', session?.metadata)
    return { skipped: true, reason: 'missing_metadata' }
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const amount = Number(session.amount_total) || Number(session.metadata?.depositCents) || 0
  const { error } = await supabase.from('payments').insert({
    trip_id: tripId,
    rider_id: riderId,
    stripe_payment_intent_id: typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || session.id,
    kind: 'deposit',
    amount_cents: amount,
    status: 'succeeded',
  })
  if (error) {
    console.error('[stripe-webhook] payments insert', error)
    return { ok: false, error: error.message }
  }
  const paid = Number(session.amount_total) || Number(session.metadata?.depositCents) || 0
  if (paid > 0) {
    const { data: trip } = await supabase.from('trips').select('metadata').eq('id', tripId).maybeSingle()
    if (trip) {
      const metadata = { ...(trip.metadata || {}) }
      metadata.fare_paid_cents = Math.max(0, Math.round(Number(metadata.fare_paid_cents) || 0) + paid)
      await supabase.from('trips').update({ metadata }).eq('id', tripId)
    }
  }
  return { ok: true }
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  if (req.method !== 'POST') {
    res.statusCode = 405
    return res.end(JSON.stringify({ error: 'Method not allowed' }))
  }

  if (!stripeSecret || !stripeSecret.startsWith('sk_') || stripeSecret.includes('placeholder')) {
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
    if (webhookSecret && !webhookSecret.includes('placeholder')) {
      const sig = req.headers['stripe-signature']
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
    } else {
      event = JSON.parse(rawBody.toString('utf8'))
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object
      const recorded = await recordDeposit(session)
      console.log('[stripe-webhook] checkout.session.completed', {
        id: session?.id,
        metadata: session?.metadata,
        amount_total: session?.amount_total,
        recorded,
      })
      res.statusCode = 200
      return res.end(JSON.stringify({ received: true, type: event.type, recorded }))
    }

    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data?.object
      const tripId = pi?.metadata?.tripId || pi?.metadata?.trip_id
      const code = classifyStripeError({
        code: pi?.last_payment_error?.code,
        decline_code: pi?.last_payment_error?.decline_code,
        message: pi?.last_payment_error?.message,
      })
      let held = false
      if (tripId && serviceKey) {
        const supabase = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
        const failure = failureResult(code, {
          amountCents: pi?.amount || 0,
          tripId,
          kind: pi?.metadata?.kind || 'balance',
        })
        await setPaymentHold(supabase, tripId, failure)
        held = true
        console.error('[stripe-webhook] payment_failed', { tripId, code, pi: pi?.id })
      }
      res.statusCode = 200
      return res.end(JSON.stringify({ received: true, type: event.type, held, code }))
    }

    console.log('[stripe-webhook] unhandled', event.type)
    res.statusCode = 200
    return res.end(JSON.stringify({ received: true, type: event.type }))
  } catch (err) {
    console.error('[stripe-webhook]', err)
    res.statusCode = 400
    return res.end(JSON.stringify({ error: err.message || 'Webhook error' }))
  }
}
