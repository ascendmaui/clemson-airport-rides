/**
 * Vercel serverless — POST /api/stripe-webhook
 * Records 25% deposits into public.payments when SUPABASE_SERVICE_ROLE_KEY is set.
 */
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { grantRiderSocialForTrip } from '../server/riderReferral.js'
import { splitPlatformFee } from '../src/lib/fareRates.js'
import { debitLots, grantCreditPack, insertChargePayment } from '../server/creditLots.js'
import { setPaymentHold } from '../server/collectPayment.js'
import { classifyStripeError, failureResult } from '../shared/paymentFailure.js'
import { releaseFromCheckoutEvent, restoreLiveTripAfterDeposit } from '../server/abandonedCheckout.js'
import { applyPaidCheckoutSession, recordDeposit } from '../server/checkoutReconcile.js'

export { recordDeposit, applyPaidCheckoutSession }

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

function serviceClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function recordTip(pi) {
  if (!serviceKey) return { skipped: true, reason: 'no_service_role' }
  const tripId = pi?.metadata?.tripId
  const riderId = pi?.metadata?.riderId
  if (!tripId || !riderId) return { skipped: true, reason: 'missing_metadata' }
  const supabase = serviceClient()
  const amount = Number(pi.amount) || Number(pi.metadata?.tipCents) || 0
  const split = splitPlatformFee(amount)
  const { data: existing } = await supabase
    .from('payments')
    .select('id')
    .eq('stripe_payment_intent_id', pi.id)
    .maybeSingle()
  if (!existing) {
    const { error } = await supabase.from('payments').insert({
      trip_id: tripId,
      rider_id: riderId,
      stripe_payment_intent_id: pi.id,
      kind: 'tip',
      amount_cents: split.amountCents,
      platform_fee_cents: split.platformFeeCents,
      driver_earnings_cents: split.driverEarningsCents,
      status: 'succeeded',
    })
    if (error) return { ok: false, error: error.message }
  }
  const { error: upErr } = await supabase.from('trips').update({ tip_cents: amount }).eq('id', tripId)
  if (upErr && !/tip_cents|column|schema cache/i.test(upErr.message || '')) {
    return { ok: false, error: upErr.message }
  }
  return { ok: true }
}

async function recordCreditPurchase(session) {
  if (!serviceKey) return { skipped: true, reason: 'no_service_role' }
  const profileId = session?.metadata?.profile_id
  const packId = session?.metadata?.pack_id
  if (!profileId || !packId) return { skipped: true, reason: 'missing_metadata' }
  const piId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || null
  return grantCreditPack(serviceClient(), {
    profileId,
    packId,
    stripePaymentIntentId: piId,
    stripeCheckoutSessionId: session.id,
  })
}

// Deposit paid-marking (payments insert, restoreLiveTripAfterDeposit, checkout_deposit stamp, referral)
// is handled idempotently via applyPaidCheckoutSession in server/checkoutReconcile.js.

export default async function handler(req, res, deps = {}) {
  res.setHeader('Content-Type', 'application/json')
  if (req.method !== 'POST') {
    res.statusCode = 405
    return res.end(JSON.stringify({ error: 'Method not allowed' }))
  }

  const stripeKey = deps.stripeSecret || process.env.STRIPE_SECRET_KEY || stripeSecret
  const whSecret = deps.webhookSecret !== undefined ? deps.webhookSecret : (process.env.STRIPE_WEBHOOK_SECRET || webhookSecret)
  const activeServiceKey = deps.serviceKey !== undefined ? deps.serviceKey : (process.env.SUPABASE_SERVICE_ROLE_KEY || serviceKey)

  if (!stripeKey || !stripeKey.startsWith('sk_') || stripeKey.includes('placeholder')) {
    res.statusCode = 200
    return res.end(JSON.stringify({
      stub: true,
      message: 'STRIPE_SECRET_KEY not set — webhook stub acknowledged',
    }))
  }

  try {
    const stripe = new Stripe(stripeKey)
    const rawBody = await readRawBody(req)
    let event
    if (whSecret && !whSecret.includes('placeholder')) {
      const sig = req.headers['stripe-signature']
      event = stripe.webhooks.constructEvent(rawBody, sig, whSecret)
    } else {
      event = JSON.parse(rawBody.toString('utf8'))
    }

    if (event.type === 'payment_intent.succeeded' && event.data?.object?.metadata?.kind === 'tip') {
      const recorded = await recordTip(event.data.object)
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
      if (tripId && activeServiceKey) {
        const failure = failureResult(code, {
          amountCents: pi?.amount || 0,
          tripId,
          kind: pi?.metadata?.kind || 'balance',
        })
        const client = deps.serviceClient ? deps.serviceClient() : serviceClient()
        await setPaymentHold(client, tripId, failure)
        held = true
        console.error('[stripe-webhook] payment_failed', { tripId, code, pi: pi?.id })
      }
      res.statusCode = 200
      return res.end(JSON.stringify({ received: true, type: event.type, held, code }))
    }

    if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      let released = { released: false, reason: 'no_service_role' }
      if (activeServiceKey) {
        const client = deps.serviceClient ? deps.serviceClient() : serviceClient()
        released = await releaseFromCheckoutEvent(client, event)
      }
      console.log('[stripe-webhook] checkout abandoned', { type: event.type, id: event.data?.object?.id, released })
      const retryable = released?.reason === 'update_failed'
        || released?.reason === 'trip_unreadable'
        || released?.reason === 'payments_unreadable'
      res.statusCode = retryable ? 500 : 200
      return res.end(JSON.stringify({ received: true, type: event.type, released }))
    }

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data?.object
      if (session?.metadata?.kind === 'credit_purchase') {
        const granted = await recordCreditPurchase(session)
        console.log('[stripe-webhook] credit_purchase', { id: session?.id, granted })
        res.statusCode = 200
        return res.end(JSON.stringify({ received: true, type: event.type, granted }))
      }
      const client = deps.serviceClient ? deps.serviceClient() : (serviceKey ? serviceClient() : null)
      const applyFn = deps.applyPaidCheckoutSession || applyPaidCheckoutSession
      const applied = await applyFn(client, session, {
        restoreLiveTripAfterDeposit: deps.restoreLiveTripAfterDeposit || restoreLiveTripAfterDeposit,
        grantRiderSocialForTrip: deps.grantRiderSocialForTrip || grantRiderSocialForTrip,
        isAsyncPaymentSucceeded: event.type === 'checkout.session.async_payment_succeeded',
      })
      const { recorded, live, referral } = applied
      console.log('[stripe-webhook] checkout.session.completed', {
        id: session?.id,
        metadata: session?.metadata,
        amount_total: session?.amount_total,
        recorded,
        live,
        referral,
      })
      res.statusCode = 200
      return res.end(JSON.stringify({ received: true, type: event.type, recorded, live, referral }))
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
