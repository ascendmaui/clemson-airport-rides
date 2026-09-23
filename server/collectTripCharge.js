/**
 * Mid-ride cancel collection.
 *
 * The payment-failure agent owns graceful card decline and credits fallback
 * in server/collectPayment.js. This module calls that export when the file
 * is present. A decline never throws and never asks the caller to roll the
 * trip back: the trip stays ended and the result is payment_required.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stripeClient, stripeOk } from './friendRideLib.js'

const SETTLED = new Set([
  'succeeded',
  'paid',
  'covered_by_credits',
  'credits',
  'covered_by_deposit',
])

let sharedLoad = null

/**
 * Dynamic import is required: collectPayment.js is optional until that agent lands.
 * A static import would break this branch while the file is absent.
 */
export function loadSharedCollectPayment() {
  if (!sharedLoad) {
    sharedLoad = (async () => {
      const file = join(dirname(fileURLToPath(import.meta.url)), 'collectPayment.js')
      if (!existsSync(file)) return null
      try {
        const mod = await import(pathToFileURL(file).href)
        const fn = mod.collectPayment || mod.default
        return typeof fn === 'function' ? fn : null
      } catch (err) {
        console.error('[collectTripCharge] collectPayment import failed', err?.message || err)
        return null
      }
    })()
  }
  return sharedLoad
}

export function resetSharedCollectPaymentForTests() {
  sharedLoad = null
}

export function isSettledPayment(status) {
  return SETTLED.has(status)
}

/** Map any collector result onto a status that does not leave the trip waiting. */
export function normalizeChargeOutcome(result, fallbackError) {
  const raw = result?.status || result?.paymentStatus || result?.payment_status || ''
  const stripePaymentIntentId = result?.stripePaymentIntentId
    || result?.paymentIntentId
    || result?.payment_intent_id
    || result?.id
    || null
  const clientSecret = result?.clientSecret || result?.client_secret || null
  const creditsAppliedCents = Number(result?.creditsAppliedCents ?? result?.creditsDebitedCents ?? 0) || 0
  const chargeError = result?.chargeError || result?.error || result?.message || fallbackError || null

  if (isSettledPayment(raw)) {
    const paymentStatus = raw === 'paid' || raw === 'credits' ? 'succeeded' : raw
    return {
      paymentStatus,
      stripePaymentIntentId,
      clientSecret: null,
      creditsAppliedCents,
      chargeError: null,
      source: result?.source || 'collectPayment',
    }
  }

  return {
    paymentStatus: 'payment_required',
    stripePaymentIntentId,
    clientSecret,
    creditsAppliedCents,
    chargeError: chargeError || 'Payment required',
    source: result?.source || 'collectPayment',
  }
}

async function chargeCardDirect({ stripe, profile, amountCents, tripId, riderId, driverId, metadata }) {
  if (!stripe) {
    return normalizeChargeOutcome({
      status: 'payment_required',
      error: 'STRIPE_SECRET_KEY is not configured',
      source: 'card',
    })
  }
  if (!profile?.stripe_customer_id || !profile?.stripe_default_pm_id) {
    return normalizeChargeOutcome({
      status: 'payment_required',
      error: 'No card on file',
      source: 'card',
    })
  }
  try {
    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      customer: profile.stripe_customer_id,
      payment_method: profile.stripe_default_pm_id,
      off_session: true,
      confirm: true,
      description: 'Clemson RIDES mid-ride cancellation',
      metadata: {
        kind: 'midride_cancel',
        trip_id: tripId,
        rider_id: riderId,
        driver_id: driverId || '',
        ...(metadata || {}),
      },
    }, {
      idempotencyKey: `midride_cancel_${tripId}`,
    })
    if (pi.status === 'succeeded') {
      return normalizeChargeOutcome({
        status: 'succeeded',
        paymentIntentId: pi.id,
        source: 'card',
      })
    }
    return normalizeChargeOutcome({
      status: 'payment_required',
      paymentIntentId: pi.id,
      error: `Payment status ${pi.status}`,
      source: 'card',
    })
  } catch (err) {
    return normalizeChargeOutcome({
      status: 'payment_required',
      paymentIntentId: err?.payment_intent?.id || err?.raw?.payment_intent?.id || null,
      error: err?.message || 'Card declined',
      source: 'card',
    })
  }
}

/**
 * Collect the mid-ride cancel amount. Never throws.
 * @returns {Promise<{paymentStatus: string, stripePaymentIntentId: string|null, clientSecret: string|null, creditsAppliedCents: number, chargeError: string|null, source: string}>}
 */
export async function collectMidrideCharge(input, deps = {}) {
  const amountCents = Math.max(0, Math.round(Number(input.amountCents) || 0))
  const shared = deps.collectPayment !== undefined
    ? deps.collectPayment
    : await loadSharedCollectPayment()

  if (typeof shared === 'function') {
    try {
      const result = await shared({
        amountCents,
        currency: 'usd',
        riderId: input.riderId,
        tripId: input.tripId,
        driverId: input.driverId || null,
        kind: 'midride_cancel',
        purpose: 'midride_cancel',
        description: 'Clemson RIDES mid-ride cancellation',
        idempotencyKey: `midride_cancel_${input.tripId}`,
        offSession: true,
        allowCredits: true,
        metadata: input.metadata || {},
        profile: input.profile || null,
        supabase: input.sb || null,
        stripe: input.stripe || null,
      })
      return normalizeChargeOutcome({ ...result, source: result?.source || 'collectPayment' })
    } catch (err) {
      return normalizeChargeOutcome({
        status: 'payment_required',
        paymentIntentId: err?.payment_intent?.id || err?.raw?.payment_intent?.id || null,
        error: err?.message || 'Card declined',
        source: 'collectPayment',
      })
    }
  }

  const stripe = input.stripe !== undefined
    ? input.stripe
    : (stripeOk() ? stripeClient() : null)
  return chargeCardDirect({
    stripe,
    profile: input.profile,
    amountCents,
    tripId: input.tripId,
    riderId: input.riderId,
    driverId: input.driverId,
    metadata: input.metadata,
  })
}
