/**
 * Place and capture a manual-capture PaymentIntent for a ride fare.
 * Uses the Stripe client already configured for this process (test or live).
 * No key is invented here. When Stripe is not configured, the hold is skipped.
 */
import { stripeClient, stripeOk } from './friendRideLib.js'
import { classifyStripeError, failureResult } from '../shared/paymentFailure.js'
import {
  capturePlan,
  fareAuthorizationCents,
  shouldRetryAuthorization,
} from '../shared/fareAuthorization.js'
import { holdQuoteCents, readBoostCents } from '../shared/scheduledBoost.js'
import { readBackupQueue } from '../shared/backupDriverQueue.js'
import { MIN_CARD_CHARGE_CENTS } from '../src/lib/fareRates.js'
import { insertPaymentRow, setPaymentHold } from './collectPayment.js'

function authKey(tripId, suffix) {
  const base = `fare_auth:${tripId || 'trip'}`
  return suffix ? `${base}:${suffix}` : base
}

function stripeErrorMessage(message) {
  if (typeof message !== 'string') return null
  return message.trim()
    .replace(/\b(?:[sr]k_(?:test|live)_[A-Za-z0-9_]+|(?:pi|seti)_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+)\b/g, '[redacted]')
    .slice(0, 300)
}

function stripeErrorField(value) {
  return typeof value === 'string' ? value : null
}

export function isIncrementalAuthIneligible(err) {
  const raw = err?.raw || err
  return raw?.code === 'payment_intent_invalid_parameter'
    && /not eligible for the requested card features/i.test(raw?.message || '')
}

async function cancelQuiet(stripe, paymentIntent) {
  const id = paymentIntent?.id
  const status = paymentIntent?.status
  if (!id || !stripe?.paymentIntents?.cancel) return false
  if (status === 'succeeded' || status === 'canceled') return false
  try {
    await stripe.paymentIntents.cancel(id)
    return true
  } catch {
    return false
  }
}

async function createAuthorization(stripe, {
  amountCents,
  customerId,
  paymentMethodId,
  tripId,
  riderId,
  quote,
  idempotencyKey,
}) {
  try {
    const params = {
      amount: amountCents,
      currency: 'usd',
      customer: customerId,
      payment_method: paymentMethodId,
      capture_method: 'manual',
      confirm: true,
      off_session: true,
      payment_method_options: {
        card: { request_incremental_authorization: 'if_available' },
      },
      description: 'Clemson RIDES fare hold',
      metadata: {
        kind: 'fare_authorization',
        tripId: String(tripId || ''),
        riderId: String(riderId || ''),
        estimatedFareCents: String(quote.estimatedFareCents),
        bufferCents: String(quote.bufferCents),
        boostCents: String(quote.boostCents || 0),
      },
    }
    let pi
    let basicAuthorization = false
    try {
      pi = await stripe.paymentIntents.create(params, { idempotencyKey })
    } catch (err) {
      if (!isIncrementalAuthIneligible(err)) throw err
      const basicParams = { ...params }
      // The incremental request is currently the only payment method option.
      delete basicParams.payment_method_options
      pi = await stripe.paymentIntents.create(basicParams, { idempotencyKey: `${idempotencyKey}:basic` })
      basicAuthorization = true
    }
    if (pi.status === 'requires_capture' || pi.status === 'succeeded') {
      return {
        ok: true, paymentIntent: pi, paymentMethodId,
        ...(basicAuthorization ? { incrementalAuthorization: false } : {}),
      }
    }
    const code = pi.status === 'requires_action' ? 'authentication_required' : 'charge_failed'
    return {
      ok: false, code, paymentIntent: pi, paymentMethodId,
      stripeError: {
        status: pi.status,
        last_payment_error: {
          code: stripeErrorField(pi.last_payment_error?.code),
          decline_code: stripeErrorField(pi.last_payment_error?.decline_code),
          message: stripeErrorMessage(pi.last_payment_error?.message),
        },
      },
    }
  } catch (err) {
    const raw = err?.raw || err
    return {
      ok: false,
      code: classifyStripeError(err),
      message: err?.message || 'Card declined',
      paymentIntent: err?.payment_intent || err?.raw?.payment_intent || null,
      paymentMethodId,
      stripeError: {
        type: stripeErrorField(raw?.type),
        code: stripeErrorField(raw?.code),
        decline_code: stripeErrorField(raw?.decline_code),
        param: stripeErrorField(raw?.param),
        message: stripeErrorMessage(raw?.message),
      },
    }
  }
}

export async function listBackupPaymentMethodIds(stripe, customerId, defaultPaymentMethodId) {
  if (!stripe?.paymentMethods?.list || !customerId) return []
  try {
    const listed = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
      limit: 10,
    })
    const ids = []
    for (const method of listed?.data || []) {
      if (!method?.id || method.id === defaultPaymentMethodId) continue
      if (!ids.includes(method.id)) ids.push(method.id)
    }
    return ids
  } catch (err) {
    console.error('[fareAuthorization] payment methods', err?.message || err)
    return []
  }
}

async function loadCardProfile(sb, riderId) {
  if (!sb || !riderId) return null
  const row = await sb
    .from('profiles')
    .select('id, stripe_customer_id, stripe_default_pm_id')
    .eq('id', riderId)
    .maybeSingle()
  if (row.error) {
    console.error('[fareAuthorization] profile', row.error.message)
    return null
  }
  return row.data
}

async function mergeTripMetadata(sb, tripId, patch) {
  if (!sb || !tripId) return
  const row = await sb.from('trips').select('id, metadata').eq('id', tripId).maybeSingle()
  if (row.error || !row.data) {
    console.error('[fareAuthorization] trip', row.error?.message || 'missing')
    return
  }
  const metadata = { ...(row.data.metadata || {}) }
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === null) delete metadata[key]
    else metadata[key] = value
  }
  const updated = await sb.from('trips').update({ metadata }).eq('id', tripId)
  if (updated.error) console.error('[fareAuthorization] metadata', updated.error.message)
}

function parkedOutstanding({ quote, code, attempts, amountCents }) {
  return {
    amountCents: Math.max(0, Math.round(Number(
      amountCents ?? ((quote.estimatedFareCents || 0) + (quote.boostCents || 0)),
    ) || 0)),
    code: code || 'charge_failed',
    reason: 'authorization_failed',
    attempts,
    at: new Date().toISOString(),
  }
}

/**
 * Authorize estimated fare + buffer on the default card.
 * A decline is retried once. Other saved cards may be charged next.
 * If every attempt fails, the estimated fare is parked as an outstanding balance
 * and the ride request still stands.
 */
export async function placeFareAuthorization({
  stripe,
  sb,
  tripId,
  riderId,
  customerId,
  paymentMethodId,
  backupPaymentMethodIds,
  estimatedFareCents,
  boostCents = 0,
  idempotencySuffix = '',
}) {
  const quote = holdQuoteCents(estimatedFareCents, boostCents)
  if (quote.authorizationCents <= 0) {
    return { ok: true, skipped: true, reason: 'zero_fare', ...quote }
  }
  if (!stripe?.paymentIntents?.create) {
    return { ok: true, skipped: true, reason: 'stripe_not_configured', ...quote }
  }
  if (!customerId || !paymentMethodId) {
    const outstanding = parkedOutstanding({
      quote,
      code: 'no_payment_method',
      attempts: [],
    })
    const failure = failureResult('no_payment_method', {
      amountCents: outstanding.amountCents,
      tripId,
      kind: 'balance',
    })
    return { ok: false, parked: true, outstanding, failure, ...quote, attempts: [] }
  }

  const backups = Array.isArray(backupPaymentMethodIds)
    ? backupPaymentMethodIds.filter((id) => id && id !== paymentMethodId)
    : await listBackupPaymentMethodIds(stripe, customerId, paymentMethodId)

  const attempts = []
  async function once(pmId, suffix) {
    const keySuffix = [idempotencySuffix, suffix].filter(Boolean).join(':')
    const result = await createAuthorization(stripe, {
      amountCents: quote.authorizationCents,
      customerId,
      paymentMethodId: pmId,
      tripId,
      riderId,
      quote,
      idempotencyKey: authKey(tripId, keySuffix),
    })
    attempts.push({
      paymentMethodId: pmId,
      suffix: suffix || 'initial',
      ok: result.ok,
      code: result.ok ? null : result.code,
      backup: pmId !== paymentMethodId,
      ...(result.stripeError ? { stripeError: result.stripeError } : {}),
    })
    if (!result.ok) {
      console.error(JSON.stringify({
        level: 'error', msg: 'fare_authorization_failed', tripId,
        code: result.code, stripeError: result.stripeError,
      }))
      await cancelQuiet(stripe, result.paymentIntent)
    }
    return result
  }

  let result = await once(paymentMethodId, '')
  if (!result.ok && shouldRetryAuthorization(result.code)) {
    result = await once(paymentMethodId, 'retry')
  }
  if (!result.ok) {
    for (const pmId of backups) {
      result = await once(pmId, `pm:${pmId}`)
      if (result.ok) break
    }
  }

  if (result.ok) {
    const authorization = {
      status: result.paymentIntent.status === 'succeeded' ? 'captured' : 'requires_capture',
      paymentIntentId: result.paymentIntent.id,
      authorizationCents: quote.authorizationCents,
      estimatedFareCents: quote.estimatedFareCents,
      bufferCents: quote.bufferCents,
      boostCents: quote.boostCents,
      paymentMethodId: result.paymentMethodId,
      backupCard: result.paymentMethodId !== paymentMethodId,
      ...(result.incrementalAuthorization === false ? { incrementalAuthorization: false } : {}),
      at: new Date().toISOString(),
    }
    if (sb && tripId) {
      await insertPaymentRow(sb, {
        trip_id: tripId,
        rider_id: riderId,
        kind: 'balance',
        amount_cents: quote.authorizationCents,
        status: authorization.status === 'captured' ? 'succeeded' : 'pending',
        stripe_payment_intent_id: result.paymentIntent.id,
        idempotency_key: authKey(tripId),
        metadata: {
          logical_kind: 'fare_authorization',
          buffer_cents: quote.bufferCents,
          estimated_fare_cents: quote.estimatedFareCents,
          boost_cents: quote.boostCents,
        },
      })
    }
    return { ok: true, authorization, attempts, ...quote }
  }

  const outstanding = parkedOutstanding({ quote, code: result.code, attempts })
  const failure = failureResult(result.code || 'charge_failed', {
    amountCents: outstanding.amountCents,
    tripId,
    kind: 'balance',
  })
  if (result.code === 'authentication_required') {
    failure.clientSecret = result.paymentIntent?.client_secret || null
    failure.paymentIntentId = result.paymentIntent?.id || null
  }
  return { ok: false, parked: true, outstanding, failure, attempts, ...quote }
}

/**
 * Hold at ride request. Schedule booking does not call this.
 * A missing Stripe key skips the hold and does not invent a charge.
 */
export async function authorizeRideRequest({
  sb,
  stripe,
  trip,
  riderId,
  estimatedFareCents,
} = {}) {
  const boostCents = readBoostCents(trip)
  const fareCents = estimatedFareCents ?? trip?.fare_cents
  const choice = trip?.metadata?.billing_choice
  // Ride credits settle the fare. A boost and a booked backup fee are still
  // card money. With neither, scheduling stays on the credits path.
  const creditsFare = choice === 'credits'
  const backupBonusCents = readBackupQueue(trip)?.bonusCents || 0
  const quote = holdQuoteCents(creditsFare ? backupBonusCents : fareCents, boostCents)
  if (creditsFare && boostCents <= 0 && backupBonusCents <= 0) {
    return { ok: true, skipped: true, reason: 'credits', ...fareAuthorizationCents(fareCents), boostCents: 0 }
  }
  const client = stripe || (stripeOk() ? stripeClient() : null)
  if (!client?.paymentIntents?.create) {
    return { ok: true, skipped: true, reason: 'stripe_not_configured', ...quote }
  }
  const profile = await loadCardProfile(sb, riderId || trip?.rider_id)
  const placed = await placeFareAuthorization({
    stripe: client,
    sb,
    tripId: trip?.id,
    riderId: riderId || trip?.rider_id,
    customerId: profile?.stripe_customer_id || null,
    paymentMethodId: profile?.stripe_default_pm_id || null,
    estimatedFareCents: quote.estimatedFareCents,
    boostCents: quote.boostCents,
    idempotencySuffix: creditsFare ? 'boost' : '',
  })
  if (sb && trip?.id && !placed.skipped) {
    await mergeTripMetadata(sb, trip.id, {
      fare_authorization: placed.authorization || {
        status: 'failed',
        authorizationCents: quote.authorizationCents,
        estimatedFareCents: quote.estimatedFareCents,
        bufferCents: quote.bufferCents,
        boostCents: quote.boostCents,
        code: placed.outstanding?.code || placed.failure?.code || null,
        at: new Date().toISOString(),
      },
      outstanding_balance: placed.parked ? placed.outstanding : null,
    })
  }
  return placed
}

/**
 * Drop an open fare hold so the rider is not charged.
 * Used when they cancel a boosted scheduled ride. No open hold is a no-op.
 */
export async function releaseOpenFareHold({ sb, stripe, trip, reason = 'rider_cancel' } = {}) {
  const auth = trip?.metadata?.fare_authorization
  if (!auth || auth.status !== 'requires_capture' || !auth.paymentIntentId) {
    return { ok: true, skipped: true, reason: 'no_open_hold' }
  }
  const client = stripe || (stripeOk() ? stripeClient() : null)
  if (!client?.paymentIntents?.cancel) {
    return { ok: true, skipped: true, reason: 'stripe_not_configured' }
  }
  const canceled = await cancelQuiet(client, { id: auth.paymentIntentId, status: 'requires_capture' })
  if (!canceled) return { ok: false, reason: 'hold_release_failed', paymentIntentId: auth.paymentIntentId }
  const fareAuthorization = {
    ...auth,
    status: 'canceled',
    reason,
    at: new Date().toISOString(),
  }
  await mergeTripMetadata(sb, trip.id, { fare_authorization: fareAuthorization })
  return { ok: true, released: true, reason, paymentIntentId: auth.paymentIntentId }
}

/**
 * Raise an open fare hold after the rider bumps a scheduled boost.
 * Uses incrementAuthorization when Stripe offers it. Otherwise the open
 * PaymentIntent is canceled and a new manual-capture hold is created.
 * No hold yet (the usual case before the 45-minute release) is a no-op.
 */
export async function syncBoostAuthorization({ sb, stripe, trip, boostCents } = {}) {
  const auth = trip?.metadata?.fare_authorization
  if (!auth || auth.status !== 'requires_capture' || !auth.paymentIntentId) {
    return { ok: true, skipped: true, reason: 'no_open_hold' }
  }
  const client = stripe || (stripeOk() ? stripeClient() : null)
  if (!client?.paymentIntents) {
    return { ok: true, skipped: true, reason: 'stripe_not_configured' }
  }
  const creditsFare = trip?.metadata?.billing_choice === 'credits'
  const quote = holdQuoteCents(creditsFare ? 0 : (auth.estimatedFareCents ?? trip?.fare_cents), boostCents)
  if (quote.authorizationCents <= Math.max(0, Math.round(Number(auth.authorizationCents) || 0))) {
    return { ok: true, skipped: true, reason: 'hold_already_covers', ...quote }
  }
  if (client.paymentIntents.incrementAuthorization) {
    try {
      await client.paymentIntents.incrementAuthorization(auth.paymentIntentId, {
        amount: quote.authorizationCents,
      }, { idempotencyKey: `fare_auth_boost:${trip.id}:${quote.boostCents}` })
      const authorization = {
        ...auth,
        authorizationCents: quote.authorizationCents,
        estimatedFareCents: quote.estimatedFareCents,
        bufferCents: quote.bufferCents,
        boostCents: quote.boostCents,
        bumpedAt: new Date().toISOString(),
      }
      await mergeTripMetadata(sb, trip.id, { fare_authorization: authorization })
      return { ok: true, method: 'increment', authorization, ...quote }
    } catch (err) {
      console.error('[fareAuthorization] boost increment', err?.message || err)
    }
  }
  await cancelQuiet(client, { id: auth.paymentIntentId, status: 'requires_capture' })
  const profile = await loadCardProfile(sb, trip.rider_id)
  const placed = await placeFareAuthorization({
    stripe: client,
    sb,
    tripId: trip.id,
    riderId: trip.rider_id,
    customerId: profile?.stripe_customer_id || null,
    paymentMethodId: auth.paymentMethodId || profile?.stripe_default_pm_id || null,
    estimatedFareCents: quote.estimatedFareCents,
    boostCents: quote.boostCents,
    idempotencySuffix: `boost:${quote.boostCents}`,
  })
  if (sb && trip.id) {
    await mergeTripMetadata(sb, trip.id, {
      fare_authorization: placed.authorization || {
        ...auth,
        status: 'failed',
        authorizationCents: quote.authorizationCents,
        boostCents: quote.boostCents,
        code: placed.outstanding?.code || placed.failure?.code || null,
        at: new Date().toISOString(),
      },
      outstanding_balance: placed.parked ? placed.outstanding : null,
    })
  }
  return { ...placed, method: placed.ok ? 'reauth' : 'reauth_failed' }
}

async function chargeOverage(stripe, {
  amountCents,
  customerId,
  paymentMethodId,
  backupPaymentMethodIds,
  tripId,
  riderId,
}) {
  const methods = [paymentMethodId, ...(backupPaymentMethodIds || [])].filter(Boolean)
  const seen = []
  let last = null
  for (const pmId of methods) {
    if (seen.includes(pmId)) continue
    seen.push(pmId)
    const suffixes = pmId === paymentMethodId ? ['', 'retry'] : [`pm:${pmId}`]
    for (const suffix of suffixes) {
      try {
        const pi = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: 'usd',
          customer: customerId,
          payment_method: pmId,
          off_session: true,
          confirm: true,
          description: 'Clemson RIDES fare balance',
          metadata: {
            kind: 'fare_balance',
            tripId: String(tripId || ''),
            riderId: String(riderId || ''),
          },
        }, { idempotencyKey: `fare_final:${tripId}:${suffix || 'initial'}:${pmId}` })
        if (pi.status === 'succeeded' || pi.status === 'processing') {
          return { ok: true, paymentIntent: pi, paymentMethodId: pmId, backupCard: pmId !== paymentMethodId }
        }
        last = { ok: false, code: 'charge_failed', paymentIntent: pi }
        await cancelQuiet(stripe, pi)
      } catch (err) {
        last = {
          ok: false,
          code: classifyStripeError(err),
          message: err?.message || 'Card declined',
          paymentIntent: err?.payment_intent || err?.raw?.payment_intent || null,
        }
      }
      if (pmId !== paymentMethodId) break
      if (last && !shouldRetryAuthorization(last.code)) break
    }
  }
  return last || { ok: false, code: 'no_payment_method' }
}

/**
 * Convert a requires_capture hold into the final fare.
 * Returns null when this trip has no open authorization.
 */
export async function settleFareHold({ sb, stripe, trip, finalFareCents } = {}) {
  const auth = trip?.metadata?.fare_authorization
  if (!auth || auth.status !== 'requires_capture' || !auth.paymentIntentId) return null
  const client = stripe || (stripeOk() ? stripeClient() : null)
  if (!client?.paymentIntents?.retrieve) return null
  if (trip?.metadata?.billing_choice === 'credits' && readBoostCents(trip) <= 0) {
    await cancelQuiet(client, { id: auth.paymentIntentId, status: 'requires_capture' })
    await mergeTripMetadata(sb, trip.id, {
      fare_authorization: { ...auth, status: 'canceled', reason: 'credits', at: new Date().toISOString() },
    })
    return null
  }

  const finalFare = Math.max(0, Math.round(Number(finalFareCents) || 0))
  const plan = capturePlan({
    authorizationCents: auth.authorizationCents,
    finalFareCents: finalFare,
    minimumChargeCents: MIN_CARD_CHARGE_CENTS,
  })
  const profile = await loadCardProfile(sb, trip.rider_id)
  const customerId = profile?.stripe_customer_id || null
  const defaultPm = auth.paymentMethodId || profile?.stripe_default_pm_id || null
  const backups = await listBackupPaymentMethodIds(client, customerId, defaultPm)

  let paymentIntent = null
  try {
    paymentIntent = await client.paymentIntents.retrieve(auth.paymentIntentId)
  } catch (err) {
    console.error('[fareAuthorization] retrieve', err?.message || err)
  }

  if (paymentIntent?.status === 'succeeded') {
    const capturedCents = Math.min(finalFare, Number(paymentIntent.amount_received || paymentIntent.amount) || finalFare)
    await recordCapture(sb, trip, auth, capturedCents, paymentIntent.id)
    return { ok: true, method: 'card', amountCents: capturedCents, paymentIntentId: paymentIntent.id, status: 'succeeded' }
  }

  if (plan.action === 'cancel' || plan.action === 'waive') {
    await cancelQuiet(client, paymentIntent || { id: auth.paymentIntentId, status: 'requires_capture' })
    await mergeTripMetadata(sb, trip.id, {
      fare_authorization: { ...auth, status: plan.action === 'waive' ? 'waived' : 'canceled', at: new Date().toISOString() },
      outstanding_balance: null,
    })
    return {
      ok: true,
      method: 'none',
      reason: plan.action === 'waive' ? 'below_minimum' : 'zero_due',
      amountCents: 0,
      status: 'succeeded',
    }
  }

  let captureCents = plan.captureCents
  if (plan.action === 'increment' && client.paymentIntents.incrementAuthorization) {
    try {
      const incremented = await client.paymentIntents.incrementAuthorization(auth.paymentIntentId, {
        amount: finalFare,
      }, { idempotencyKey: `fare_auth_increment:${trip.id}` })
      paymentIntent = incremented
      captureCents = finalFare
    } catch (err) {
      console.error('[fareAuthorization] increment', err?.message || err)
      captureCents = plan.captureCents
    }
  }

  let captured = null
  let captureError = null
  for (const suffix of ['', 'retry']) {
    try {
      captured = await client.paymentIntents.capture(auth.paymentIntentId, {
        amount_to_capture: captureCents,
      }, { idempotencyKey: `fare_capture:${trip.id}${suffix ? `:${suffix}` : ''}` })
      if (captured.status === 'succeeded' || captured.status === 'processing') {
        captureError = null
        break
      }
      captureError = { code: 'charge_failed', message: `Payment status ${captured.status}` }
    } catch (err) {
      captureError = { code: classifyStripeError(err), message: err?.message || 'Card declined' }
      if (!shouldRetryAuthorization(captureError.code)) break
    }
  }

  if (captureError) {
    try {
      const again = await client.paymentIntents.retrieve(auth.paymentIntentId)
      if (again?.status === 'succeeded' || again?.status === 'processing') {
        captured = again
        captureError = null
      }
    } catch (err) {
      console.error('[fareAuthorization] retrieve after capture', err?.message || err)
    }
  }

  if (captureError) {
    const canceled = await cancelQuiet(client, { id: auth.paymentIntentId, status: 'requires_capture' })
    if (canceled && customerId && defaultPm) {
      const replacement = await chargeOverage(client, {
        amountCents: finalFare,
        customerId,
        paymentMethodId: defaultPm,
        backupPaymentMethodIds: backups,
        tripId: trip.id,
        riderId: trip.rider_id,
      })
      if (replacement.ok) {
        await recordCapture(sb, trip, auth, finalFare, replacement.paymentIntent.id, { replaced: true })
        return {
          ok: true,
          method: 'card',
          amountCents: finalFare,
          paymentIntentId: replacement.paymentIntent.id,
          backupCard: Boolean(replacement.backupCard),
          status: 'succeeded',
        }
      }
      captureError = replacement
    }
    const outstanding = {
      amountCents: finalFare,
      code: captureError.code || 'charge_failed',
      reason: 'capture_failed',
      at: new Date().toISOString(),
    }
    const failure = failureResult(outstanding.code === 'no_payment_method' ? 'no_payment_method' : (outstanding.code || 'charge_failed'), {
      amountCents: finalFare,
      tripId: trip.id,
      kind: 'balance',
    })
    if (sb) await setPaymentHold(sb, trip.id, failure)
    await mergeTripMetadata(sb, trip.id, { outstanding_balance: outstanding })
    return { ...failure, parked: true, outstanding }
  }

  const capturedAmount = Math.max(0, Math.round(Number(captured.amount_received || captureCents) || captureCents))
  const overage = Math.max(0, finalFare - capturedAmount)
  if (overage <= 0) {
    await recordCapture(sb, trip, auth, capturedAmount, captured.id)
    return { ok: true, method: 'card', amountCents: capturedAmount, paymentIntentId: captured.id, status: 'succeeded' }
  }

  const extra = customerId && defaultPm
    ? await chargeOverage(client, {
      amountCents: overage,
      customerId,
      paymentMethodId: defaultPm,
      backupPaymentMethodIds: backups,
      tripId: trip.id,
      riderId: trip.rider_id,
    })
    : { ok: false, code: 'no_payment_method' }

  if (extra.ok) {
    await recordCapture(sb, trip, auth, finalFare, captured.id, { overagePaymentIntentId: extra.paymentIntent.id })
    return {
      ok: true,
      method: 'card',
      amountCents: finalFare,
      paymentIntentId: captured.id,
      overagePaymentIntentId: extra.paymentIntent.id,
      backupCard: Boolean(extra.backupCard),
      status: 'succeeded',
    }
  }

  await recordCapture(sb, trip, { ...auth, status: 'partial' }, capturedAmount, captured.id)
  const outstanding = {
    amountCents: overage,
    code: extra.code || 'charge_failed',
    reason: 'overage_failed',
    capturedCents: capturedAmount,
    at: new Date().toISOString(),
  }
  const failure = failureResult(outstanding.code === 'no_payment_method' ? 'no_payment_method' : (outstanding.code || 'charge_failed'), {
    amountCents: overage,
    tripId: trip.id,
    kind: 'balance',
  })
  if (sb) await setPaymentHold(sb, trip.id, failure)
  await mergeTripMetadata(sb, trip.id, {
    fare_authorization: {
      ...auth,
      status: 'partial',
      capturedCents: capturedAmount,
      paymentIntentId: captured.id,
    },
    outstanding_balance: outstanding,
  })
  return { ...failure, parked: true, outstanding, capturedCents: capturedAmount }
}

async function recordCapture(sb, trip, auth, capturedCents, paymentIntentId, extra = {}) {
  if (sb && trip?.id) {
    await insertPaymentRow(sb, {
      trip_id: trip.id,
      rider_id: trip.rider_id,
      kind: 'balance',
      amount_cents: capturedCents,
      status: 'succeeded',
      stripe_payment_intent_id: paymentIntentId,
      idempotency_key: authKey(trip.id),
      metadata: {
        logical_kind: 'fare_authorization',
        captured_cents: capturedCents,
        ...extra,
      },
    })
    const prior = Math.max(0, Math.round(Number(trip.metadata?.fare_paid_cents) || 0))
    await mergeTripMetadata(sb, trip.id, {
      fare_authorization: {
        ...auth,
        status: extra && auth.status === 'partial' ? 'partial' : 'captured',
        capturedCents,
        paymentIntentId,
        ...extra,
      },
      fare_paid_cents: prior + capturedCents,
      outstanding_balance: null,
    })
  }
}
