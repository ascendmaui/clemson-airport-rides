/**
 * Vercel serverless — POST /api/stripe-webhook
 * Records a legacy airport Checkout payment into public.payments when SUPABASE_SERVICE_ROLE_KEY is set.
 * New bookings do not open that Checkout session. A late paid session still records the amount already paid.
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
import { activateTigerPassFromCheckout, syncTigerPassFromStripe, tigerPassMeta } from '../server/riderPass.js'

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

const MAX_WEBHOOK_PAYLOAD_BYTES = 1024 * 1024

export function readRawBody(req, maxBytes = MAX_WEBHOOK_PAYLOAD_BYTES) {
  if (Buffer.isBuffer(req?.rawBody)) return Promise.resolve(req.rawBody)
  if (typeof req?.rawBody === 'string') return Promise.resolve(Buffer.from(req.rawBody))
  if (Buffer.isBuffer(req?.body)) return Promise.resolve(req.body)
  if (typeof req?.body === 'string') return Promise.resolve(Buffer.from(req.body))
  return new Promise((resolve, reject) => {
    const chunks = []
    let totalLength = 0
    req.on('data', (c) => {
      totalLength += c.length
      if (totalLength > maxBytes) {
        if (typeof req.destroy === 'function') req.destroy(new Error('Payload too large'))
        reject(new Error('Payload too large'))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function serviceClient(key) {
  const k = (key !== undefined ? key : serviceKey) || ''
  if (!k) return null
  return createClient(supabaseUrl, k, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function recordTip(pi) {
  if (!serviceKey) return { skipped: true, reason: 'no_service_role' }
  const tripId = pi?.metadata?.tripId
  const riderId = pi?.metadata?.riderId
  if (!tripId || !riderId) return { skipped: true, reason: 'missing_metadata' }
  const supabase = serviceClient()
  if (!supabase) return { skipped: true, reason: 'no_service_role' }
  const amount = Number(pi.amount) || Number(pi.metadata?.tipCents) || 0
  const split = splitPlatformFee(amount)
  const { data: existing, error: selErr } = await supabase
    .from('payments')
    .select('id')
    .eq('stripe_payment_intent_id', pi.id)
    .maybeSingle()
  if (selErr) return { ok: false, error: selErr.message }
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
  const supabase = serviceClient()
  if (!supabase) return { skipped: true, reason: 'no_service_role' }
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

// Deposit paid-marking (payments insert, restoreLiveTripAfterDeposit, checkout_deposit stamp, referral)
// is handled idempotently via applyPaidCheckoutSession in server/checkoutReconcile.js.

export function extractStripeSignature(headers) {
  if (!headers || typeof headers !== 'object') return ''
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'stripe-signature') {
      const val = Array.isArray(value) ? value[0] : value
      return typeof val === 'string' ? val.trim() : ''
    }
  }
  return ''
}

function sendWebhookJson(res, status, body) {
  if (res.writableEnded) return
  res.statusCode = status
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    res.setHeader('Pragma', 'no-cache')
  }
  res.end(JSON.stringify(body))
}

export default async function handler(req, res, deps = {}) {
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    res.setHeader('Pragma', 'no-cache')
  }
  if (req.method !== 'POST') {
    if (!res.headersSent) res.setHeader('Allow', 'POST')
    return sendWebhookJson(res, 405, { error: 'Method not allowed' })
  }

  const rawStripeKey = deps.stripeSecret !== undefined ? deps.stripeSecret : (process.env.STRIPE_SECRET_KEY || stripeSecret)
  const stripeKey = typeof rawStripeKey === 'string' ? rawStripeKey.trim() : ''
  const rawWhSecret = deps.webhookSecret !== undefined ? deps.webhookSecret : (process.env.STRIPE_WEBHOOK_SECRET || webhookSecret)
  const whSecret = typeof rawWhSecret === 'string' ? rawWhSecret.trim() : ''
  const rawServiceKey = deps.serviceKey !== undefined ? deps.serviceKey : (process.env.SUPABASE_SERVICE_ROLE_KEY || serviceKey)
  const activeServiceKey = typeof rawServiceKey === 'string' ? rawServiceKey.trim() : ''

  const isValidKey = (stripeKey.startsWith('sk_') || stripeKey.startsWith('rk_')) && !stripeKey.includes('placeholder')
  if (!stripeKey || !isValidKey) {
    return sendWebhookJson(res, 200, {
      stub: true,
      message: 'STRIPE_SECRET_KEY not set — webhook stub acknowledged',
    })
  }

  try {
    const stripe = new Stripe(stripeKey)
    const rawBody = await readRawBody(req)
    let event
    if (whSecret && !whSecret.includes('placeholder')) {
      const sig = extractStripeSignature(req.headers)
      event = stripe.webhooks.constructEvent(rawBody, sig, whSecret)
    } else {
      event = JSON.parse(rawBody.toString('utf8'))
    }

    if (event.type === 'payment_intent.succeeded' && event.data?.object?.metadata?.kind === 'tip') {
      const recordTipFn = deps.recordTip || recordTip
      const recorded = await recordTipFn(event.data.object)
      const retryable = recorded?.ok === false && !recorded?.skipped
      return sendWebhookJson(res, retryable ? 500 : 200, {
        received: true,
        type: event.type,
        recorded,
        ...(retryable ? { error: recorded.error } : {}),
      })
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
      return sendWebhookJson(res, 200, { received: true, type: event.type, held, code })
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
      return sendWebhookJson(res, retryable ? 500 : 200, { received: true, type: event.type, released })
    }

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data?.object
      if (session?.metadata?.kind === 'tiger_pass') {
        let tigerPass = { skipped: true, reason: 'no_service_role' }
        if (activeServiceKey || deps.serviceClient) {
          const client = deps.serviceClient ? deps.serviceClient() : serviceClient()
          const activateTigerPassFn = deps.activateTigerPassFromCheckout || activateTigerPassFromCheckout
          tigerPass = await activateTigerPassFn(client, session, new Date(), stripe)
        }
        console.log('[stripe-webhook] tiger_pass', { id: session?.id, tigerPass })
        const retryable = tigerPass?.ok === false
        return sendWebhookJson(res, retryable ? 500 : 200, { received: true, type: event.type, tigerPass })
      }
      if (session?.metadata?.kind === 'credit_purchase') {
        const recordCreditPurchaseFn = deps.recordCreditPurchase || recordCreditPurchase
        const granted = await recordCreditPurchaseFn(session)
        console.log('[stripe-webhook] credit_purchase', { id: session?.id, granted })
        const retryable = granted?.ok === false
        return sendWebhookJson(res, retryable ? 500 : 200, { received: true, type: event.type, granted })
      }
      const client = deps.serviceClient ? deps.serviceClient() : (activeServiceKey ? serviceClient() : null)
      const applyFn = deps.applyPaidCheckoutSession || applyPaidCheckoutSession
      const applied = await applyFn(client, session, {
        restoreLiveTripAfterDeposit: deps.restoreLiveTripAfterDeposit || restoreLiveTripAfterDeposit,
        grantRiderSocialForTrip: deps.grantRiderSocialForTrip || grantRiderSocialForTrip,
        isAsyncPaymentSucceeded: event.type === 'checkout.session.async_payment_succeeded',
      })
      const { recorded, live, referral } = applied || {}
      console.log('[stripe-webhook] checkout.session.completed', {
        id: session?.id,
        metadata: session?.metadata,
        amount_total: session?.amount_total,
        recorded,
        live,
        referral,
      })
      const retryable = (applied?.ok === false && !applied?.skipped) || (recorded && recorded.ok === false && !recorded.skipped)
      return sendWebhookJson(res, retryable ? 500 : 200, {
        received: true,
        type: event.type,
        recorded,
        live,
        referral,
        ...(retryable ? { error: applied?.error || recorded?.error } : {}),
      })
    }

    const passMeta = tigerPassMeta(event.data?.object)
    if (
      passMeta
      && (event.type === 'customer.subscription.deleted'
        || event.type === 'customer.subscription.updated'
        || event.type === 'invoice.paid')
    ) {
      let tigerPass = { skipped: true, reason: 'no_service_role' }
      if (activeServiceKey || deps.serviceClient) {
        const client = deps.serviceClient ? deps.serviceClient() : serviceClient()
        const syncTigerPassFn = deps.syncTigerPassFromStripe || syncTigerPassFromStripe
        tigerPass = await syncTigerPassFn(client, event.data.object)
      }
      const retryable = tigerPass?.ok === false
      return sendWebhookJson(res, retryable ? 500 : 200, { received: true, type: event.type, tigerPass })
    }

    console.log('[stripe-webhook] unhandled', event.type)
    return sendWebhookJson(res, 200, { received: true, type: event.type })
  } catch (err) {
    console.error('[stripe-webhook]', err)
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 600
      ? err.status
      : (typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 400)
    return sendWebhookJson(res, status, { error: err.message || 'Webhook error' })
  }
}
