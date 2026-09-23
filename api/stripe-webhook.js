/**
 * Vercel serverless — POST /api/stripe-webhook
 * Records 25% deposits into public.payments when SUPABASE_SERVICE_ROLE_KEY is set.
 */
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { splitPlatformFee } from '../src/lib/fareRates.js'
import { debitLots, grantCreditPack, insertChargePayment } from '../server/credits.js'

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
  const piId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || session.id
  const split = splitPlatformFee(amount)
  const { error } = await supabase.from('payments').insert({
    trip_id: tripId,
    rider_id: riderId,
    stripe_payment_intent_id: piId,
    kind: 'deposit',
    amount_cents: split.amountCents,
    platform_fee_cents: split.platformFeeCents,
    driver_earnings_cents: split.driverEarningsCents,
    status: 'succeeded',
    metadata: { kind: session.metadata?.kind || 'deposit', airport: session.metadata?.airport || null },
  })
  if (error && !/duplicate|unique/i.test(error.message || '')) {
    console.error('[stripe-webhook] payments insert', error)
    return { ok: false, error: error.message }
  }

  const { data: trip } = await supabase.from('trips').select('id, metadata').eq('id', tripId).maybeSingle()
  const meta = trip?.metadata || {}
  const debits = Array.isArray(meta.pending_credit_debits) ? meta.pending_credit_debits : []
  if (debits.length && !meta.credits_applied) {
    const credits = debits.reduce((sum, d) => sum + (Number(d.debitCents) || 0), 0)
    await debitLots(supabase, {
      profileId: riderId,
      debits,
      note: `airport-deposit:${session.id}`,
      tripId,
    })
    if (credits > 0) {
      await insertChargePayment(supabase, {
        riderId,
        tripId,
        kind: 'ride_fare',
        amountCents: credits,
        metadata: { method: 'credits', checkout_session: session.id },
      })
    }
    await supabase.from('trips').update({
      metadata: { ...meta, credits_applied: true, pending_credit_debits: [] },
    }).eq('id', tripId)
  }
  return { ok: true }
}

async function recordCreditPurchase(session) {
  if (!serviceKey) return { skipped: true, reason: 'no_service_role' }
  const profileId = session?.metadata?.profile_id
  const packId = session?.metadata?.pack_id
  if (!profileId || !packId) return { skipped: true, reason: 'missing_metadata' }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const piId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || null
  return grantCreditPack(supabase, {
    profileId,
    packId,
    stripePaymentIntentId: piId,
    stripeCheckoutSessionId: session.id,
  })
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
      if (session?.metadata?.kind === 'credit_purchase') {
        const granted = await recordCreditPurchase(session)
        console.log('[stripe-webhook] credit_purchase', { id: session?.id, granted })
        res.statusCode = 200
        return res.end(JSON.stringify({ received: true, type: event.type, granted }))
      }
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

    console.log('[stripe-webhook] unhandled', event.type)
    res.statusCode = 200
    return res.end(JSON.stringify({ received: true, type: event.type }))
  } catch (err) {
    console.error('[stripe-webhook]', err)
    res.statusCode = 400
    return res.end(JSON.stringify({ error: err.message || 'Webhook error' }))
  }
}
