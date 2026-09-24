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
  const supabase = serviceClient()
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
  const meta = trip?.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
  const debits = Array.isArray(meta.pending_credit_debits) ? meta.pending_credit_debits : []
  const nextMeta = { ...meta }
  if (amount > 0) {
    nextMeta.fare_paid_cents = Math.max(0, Math.round(Number(meta.fare_paid_cents) || 0) + amount)
  }
  // Happy-path paid marker for the driver match gate (restore path also stamps this).
  if (!nextMeta.checkout_deposit || typeof nextMeta.checkout_deposit !== 'object') {
    nextMeta.checkout_deposit = { session_id: session?.id || null, at: new Date().toISOString() }
  }
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
    nextMeta.credits_applied = true
    nextMeta.pending_credit_debits = []
  }
  if (trip) {
    await supabase.from('trips').update({ metadata: nextMeta }).eq('id', tripId)
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
      if (tripId && serviceKey) {
        const failure = failureResult(code, {
          amountCents: pi?.amount || 0,
          tripId,
          kind: pi?.metadata?.kind || 'balance',
        })
        await setPaymentHold(serviceClient(), tripId, failure)
        held = true
        console.error('[stripe-webhook] payment_failed', { tripId, code, pi: pi?.id })
      }
      res.statusCode = 200
      return res.end(JSON.stringify({ received: true, type: event.type, held, code }))
    }

    if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      let released = { released: false, reason: 'no_service_role' }
      if (serviceKey) released = await releaseFromCheckoutEvent(serviceClient(), event)
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
      const recorded = await recordDeposit(session)
      const paid = session?.payment_status === 'paid'
        || session?.payment_status === 'no_payment_required'
        || event.type === 'checkout.session.async_payment_succeeded'
      // A canceled Checkout can mark the trip canceled before a late success
      // lands. Put that paid trip back in searching (or scheduled) once.
      let live = null
      if (serviceKey && paid) live = await restoreLiveTripAfterDeposit(serviceClient(), session)
      // Payment success hook. Grant is idempotent and does nothing until the
      // trip itself is completed (deposits alone do not reward signups).
      let referral = null
      const tripId = session?.metadata?.tripId
      if (serviceKey && tripId) {
        const supabase = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
        referral = await grantRiderSocialForTrip(supabase, tripId)
      }
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
