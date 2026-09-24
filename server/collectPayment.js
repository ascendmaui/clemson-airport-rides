/**
 * collectPayment — ordered credits then card, structured failures, trip hold.
 *
 * Callers pass amountCents. Wait-fee and cancel-fee formulas stay with their
 * owners; import this helper instead of copying Stripe decline handling.
 */
import { supabaseCreditStore } from './credits.js'
import {
  cardIntentKey,
  creditsIntentKey,
  isOpenPaymentIntent,
  isPaidPaymentIntent,
  openIntentCode,
  resolveExistingPaymentIntent,
} from './chargeIdempotency.js'
import {
  classifyStripeError,
  failureResult,
  isFareKind,
  planCollection,
} from '../shared/paymentFailure.js'

const KIND_FALLBACK = {
  tip: 'balance',
  wait_fee: 'balance',
  cancel_fee: 'balance',
  mid_ride: 'balance',
  credits_purchase: 'balance',
  friend_ride_share: 'friend_ride_share',
  deposit: 'deposit',
  balance: 'balance',
  refund: 'refund',
}

function schemaMiss(error) {
  return /column|schema cache|check constraint|payments_kind/i.test(error?.message || '')
}

export async function loadPayerProfile(sb, riderId) {
  if (!sb || !riderId) return null
  const rich = await sb
    .from('profiles')
    .select('id, email, full_name, stripe_customer_id, stripe_default_pm_id, role')
    .eq('id', riderId)
    .maybeSingle()
  if (!rich.error) return rich.data
  if (/column|schema cache|role/i.test(rich.error.message || '')) {
    const basic = await sb
      .from('profiles')
      .select('id, email, full_name, stripe_customer_id, stripe_default_pm_id')
      .eq('id', riderId)
      .maybeSingle()
    if (!basic.error) return basic.data
  }
  console.error('[collectPayment] profile', rich.error.message)
  return null
}

export async function insertPaymentRow(sb, row) {
  if (!sb) return { id: null, error: 'no_db' }
  if (row.idempotency_key) {
    const existing = await sb
      .from('payments')
      .select('id, status, stripe_payment_intent_id')
      .eq('idempotency_key', row.idempotency_key)
      .maybeSingle()
    if (!existing.error && existing.data?.id) {
      const nextPi = row.stripe_payment_intent_id
      const samePi = !nextPi || nextPi === existing.data.stripe_payment_intent_id
      if (existing.data.status === 'succeeded' && row.status !== 'succeeded' && samePi) {
        return { id: existing.data.id, error: null }
      }
      const patch = {
        amount_cents: row.amount_cents,
        status: row.status,
        kind: row.kind,
      }
      if (row.stripe_payment_intent_id) patch.stripe_payment_intent_id = row.stripe_payment_intent_id
      const richPatch = {
        ...patch,
        metadata: { ...(row.metadata || {}), logical_kind: row.kind },
      }
      let upd = await sb.from('payments').update(richPatch).eq('id', existing.data.id)
      if (upd.error && /metadata|column|schema cache/i.test(upd.error.message || '')) {
        upd = await sb.from('payments').update(patch).eq('id', existing.data.id)
      }
      if (upd.error) {
        console.error('[collectPayment] payments update', upd.error.message)
        return { id: existing.data.id, error: upd.error.message }
      }
      return { id: existing.data.id, error: null }
    }
  }
  const logicalKind = row.kind
  const core = {
    trip_id: row.trip_id ?? null,
    rider_id: row.rider_id,
    stripe_payment_intent_id: row.stripe_payment_intent_id || `local:${logicalKind}:${row.idempotency_key || row.trip_id || 'na'}`,
    kind: logicalKind,
    amount_cents: row.amount_cents,
    status: row.status,
  }
  const rich = {
    ...core,
    idempotency_key: row.idempotency_key || null,
    metadata: { ...(row.metadata || {}), logical_kind: logicalKind },
  }
  let attempt = await sb.from('payments').insert(rich).select('id').single()
  if (attempt.error && /metadata|idempotency_key|column|schema cache/i.test(attempt.error.message || '')) {
    attempt = await sb.from('payments').insert(core).select('id').single()
  }
  if (attempt.error && schemaMiss(attempt.error) && KIND_FALLBACK[logicalKind] && KIND_FALLBACK[logicalKind] !== logicalKind) {
    attempt = await sb.from('payments').insert({ ...core, kind: KIND_FALLBACK[logicalKind] }).select('id').single()
  }
  if (attempt.error) {
    console.error('[collectPayment] payments insert', attempt.error.message)
    return { id: null, error: attempt.error.message }
  }
  return { id: attempt.data?.id || null, error: null }
}

export async function findPaymentByIdempotency(sb, idempotencyKey) {
  if (!sb || !idempotencyKey) return null
  const row = await sb.from('payments').select('id, status, amount_cents, stripe_payment_intent_id, kind, metadata').eq('idempotency_key', idempotencyKey).maybeSingle()
  if (row.error) {
    if (/column|schema cache|idempotency/i.test(row.error.message || '')) return null
    console.error('[collectPayment] idempotency lookup', row.error.message)
    return null
  }
  if (!row.data || row.data.status !== 'succeeded') return null
  return {
    id: row.data.id,
    status: row.data.status,
    amountCents: row.data.amount_cents,
    paymentIntentId: row.data.stripe_payment_intent_id,
  }
}

/** Any payments row for this key that already points at a Stripe PaymentIntent. */
export async function findPaymentIntentByKey(sb, idempotencyKey) {
  if (!sb || !idempotencyKey) return null
  const row = await sb
    .from('payments')
    .select('id, status, amount_cents, stripe_payment_intent_id, kind, metadata')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (row.error) {
    if (/column|schema cache|idempotency/i.test(row.error.message || '')) return null
    console.error('[collectPayment] intent lookup', row.error.message)
    return null
  }
  const pi = row.data?.stripe_payment_intent_id
  if (!pi || !String(pi).startsWith('pi_')) return null
  return {
    id: row.data.id,
    status: row.data.status,
    amountCents: row.data.amount_cents,
    paymentIntentId: pi,
  }
}

async function readTrip(sb, tripId) {
  if (!sb || !tripId) return null
  const row = await sb.from('trips').select('id, status, metadata, fare_cents, rider_id, driver_id').eq('id', tripId).maybeSingle()
  if (row.error) {
    console.error('[collectPayment] trip', row.error.message)
    return null
  }
  return row.data
}

export async function setPaymentHold(sb, tripId, failure) {
  if (!sb || !tripId || !failure) return
  const trip = await readTrip(sb, tripId)
  if (!trip) return
  const metadata = {
    ...(trip.metadata || {}),
    payment_hold: {
      status: 'payment_required',
      code: failure.code,
      message: failure.message,
      alternatives: failure.alternatives,
      amountCents: failure.amountDueCents,
      kind: failure.kind || null,
      at: new Date().toISOString(),
    },
  }
  const patch = { metadata, payment_status: 'payment_required' }
  let upd = await sb.from('trips').update(patch).eq('id', tripId)
  if (upd.error && /payment_status|column|schema cache/i.test(upd.error.message || '')) {
    upd = await sb.from('trips').update({ metadata }).eq('id', tripId)
  }
  if (upd.error) console.error('[collectPayment] hold', upd.error.message)
}

export async function clearPaymentHold(sb, tripId, { farePaidDelta = 0 } = {}) {
  if (!sb || !tripId) return
  const trip = await readTrip(sb, tripId)
  if (!trip) return
  const metadata = { ...(trip.metadata || {}) }
  delete metadata.payment_hold
  if (farePaidDelta) {
    metadata.fare_paid_cents = Math.max(0, Math.round(Number(metadata.fare_paid_cents) || 0) + farePaidDelta)
  }
  const patch = { metadata, payment_status: 'paid' }
  let upd = await sb.from('trips').update(patch).eq('id', tripId)
  if (upd.error && /payment_status|column|schema cache/i.test(upd.error.message || '')) {
    upd = await sb.from('trips').update({ metadata }).eq('id', tripId)
  }
  if (upd.error) console.error('[collectPayment] clear hold', upd.error.message)
}

export function defaultCollectDeps(sb, stripe) {
  const credits = supabaseCreditStore(sb)
  return {
    getCredits: (userId) => credits.getCredits(userId),
    applyCredits: (userId, delta, meta) => credits.applyCredits(userId, delta, meta),
    insertPayment: (row) => insertPaymentRow(sb, row),
    findPayment: (key) => findPaymentByIdempotency(sb, key),
    findPaymentIntent: (key) => findPaymentIntentByKey(sb, key),
    setHold: (tripId, failure) => setPaymentHold(sb, tripId, failure),
    clearHold: (tripId, extra) => clearPaymentHold(sb, tripId, extra),
    loadProfile: (userId) => loadPayerProfile(sb, userId),
    retrievePaymentIntent: async (id) => {
      if (!stripe?.paymentIntents?.retrieve) return null
      return stripe.paymentIntents.retrieve(id)
    },
    updatePaymentIntent: async (id, params) => {
      if (!stripe?.paymentIntents?.update) {
        throw Object.assign(new Error('PaymentIntent is not updatable'), { code: 'payment_intent_unexpected_state' })
      }
      return stripe.paymentIntents.update(id, params)
    },
    createPaymentIntent: async (params, options) => {
      if (!stripe?.paymentIntents?.create) {
        const err = new Error('Stripe is not configured')
        err.code = 'charge_failed'
        throw err
      }
      return stripe.paymentIntents.create(params, options)
    },
  }
}

/**
 * @param {object} input
 * @param {string} [input.tripId]
 * @param {string} input.riderId
 * @param {number} input.amountCents
 * @param {string[]} [input.methods] credits then card by default
 * @param {string} [input.kind]
 * @param {boolean} [input.adminOverride]
 * @param {boolean} [input.hold] write payment_required hold on the trip
 * @param {boolean} [input.midRide]
 */
export async function collectPayment(input) {
  const {
    tripId = null,
    riderId,
    amountCents,
    methods = ['credits', 'card'],
    kind = 'balance',
    idempotencyKey = null,
    existingPaymentIntentId = null,
    metadata = {},
    adminOverride = false,
    paymentMethodId = null,
    hold = true,
    midRide = false,
    deps,
    sb,
    stripe,
  } = input

  const io = deps || defaultCollectDeps(sb, stripe)
  const amount = Math.max(0, Math.round(Number(amountCents) || 0))

  if (adminOverride) {
    const recorded = await io.insertPayment({
      trip_id: tripId,
      rider_id: riderId,
      kind,
      amount_cents: amount,
      status: 'succeeded',
      stripe_payment_intent_id: null,
      idempotency_key: idempotencyKey,
      metadata: { ...metadata, logical_kind: kind, admin_override: true },
    })
    if (hold && tripId) await io.clearHold(tripId, { farePaidDelta: isFareKind(kind) ? amount : 0 })
    return {
      ok: true,
      status: 'succeeded',
      method: 'admin',
      reason: 'admin_override',
      amountCents: amount,
      creditsAppliedCents: 0,
      cardChargedCents: 0,
      paymentId: recorded.id,
      kind,
    }
  }

  if (idempotencyKey && io.findPayment) {
    const existing = await io.findPayment(idempotencyKey)
    if (existing && !(await succeededChargeWasCanceled(io, existing, existingPaymentIntentId))) {
      return {
        ok: true,
        status: 'succeeded',
        idempotent: true,
        method: 'idempotent',
        amountCents: existing.amountCents ?? amount,
        paymentId: existing.id,
        paymentIntentId: existing.paymentIntentId || existing.stripe_payment_intent_id || null,
        creditsAppliedCents: 0,
        cardChargedCents: 0,
        kind,
      }
    }
  }

  if (amount === 0) {
    const recorded = await io.insertPayment({
      trip_id: tripId,
      rider_id: riderId,
      kind,
      amount_cents: 0,
      status: 'succeeded',
      stripe_payment_intent_id: idempotencyKey ? `zero:${idempotencyKey}` : null,
      idempotency_key: idempotencyKey,
      metadata: { ...metadata, logical_kind: kind, zero: true },
    })
    if (hold && tripId) await io.clearHold(tripId, { farePaidDelta: 0 })
    return {
      ok: true,
      status: 'succeeded',
      zero: true,
      method: 'none',
      reason: 'zero_due',
      amountCents: 0,
      creditsAppliedCents: 0,
      cardChargedCents: 0,
      paymentId: recorded.id,
      kind,
    }
  }

  const profile = riderId ? await io.loadProfile(riderId) : null
  const creditState = riderId ? await io.getCredits(riderId) : { balanceCents: 0, unavailable: true }
  const pmId = paymentMethodId || profile?.stripe_default_pm_id || null
  const hasCard = Boolean(pmId && (profile?.stripe_customer_id || paymentMethodId))

  const plan = planCollection({
    amountCents: amount,
    creditsBalanceCents: creditState.balanceCents,
    methods,
    hasCard,
    creditsUnavailable: Boolean(creditState.unavailable),
    midRide,
  })

  const cardCents = plan.ok
    ? (plan.allocations.find((row) => row.method === 'card')?.cents ?? null)
    : null
  let chargeAttempt = null
  const existingIntent = await lookupExistingIntent(io, {
    idempotencyKey,
    existingPaymentIntentId,
    amountCents: cardCents ?? amount,
  })
  if (existingIntent.action === 'already_paid') {
    return recordPaidIntent(io, existingIntent.paymentIntent, {
      tripId, riderId, kind, amount, idempotencyKey, metadata, hold,
    })
  }
  if (existingIntent.action === 'return') {
    return recordOpenIntent(io, existingIntent.paymentIntent, {
      tripId, riderId, kind, amount, idempotencyKey, metadata, hold,
      creditsBalanceCents: creditState.balanceCents,
    })
  }
  if (existingIntent.action === 'create_attempt') chargeAttempt = existingIntent.attempt

  if (!plan.ok) {
    const failure = { ...plan, kind, tripId }
    console.error('[collectPayment]', failure.code, { tripId, riderId, kind, amount })
    if (hold && tripId) await io.setHold(tripId, failure)
    await io.insertPayment({
      trip_id: tripId,
      rider_id: riderId,
      kind,
      amount_cents: amount,
      status: 'failed',
      idempotency_key: null,
      metadata: { ...metadata, logical_kind: kind, code: failure.code },
    })
    return failure
  }

  let creditsDebited = 0
  const creditKey = creditsIntentKey(idempotencyKey, chargeAttempt)
  try {
    const creditAlloc = plan.allocations.find((row) => row.method === 'credits')
    if (creditAlloc && riderId) {
      const debit = await io.applyCredits(riderId, -creditAlloc.cents, {
        kind,
        tripId,
        idempotencyKey: creditKey,
      })
      if (!debit.ok) {
        const code = debit.code === 'credits_unavailable' ? 'credits_unavailable' : 'credits_insufficient'
        const failure = failureResult(code, {
          amountCents: amount,
          creditsBalanceCents: debit.balanceCents ?? creditState.balanceCents,
          kind,
          tripId,
        })
        console.error('[collectPayment]', failure.code, { tripId, riderId, kind })
        if (hold && tripId) await io.setHold(tripId, failure)
        return failure
      }
      if (!debit.duplicate) creditsDebited = creditAlloc.cents
    }

    let paymentIntent = null
    const cardAlloc = plan.allocations.find((row) => row.method === 'card')
    if (cardAlloc) {
      const customerId = profile?.stripe_customer_id
      if (!customerId || !pmId) {
        throw Object.assign(new Error('No payment method on file'), { code: 'resource_missing' })
      }
      paymentIntent = await io.createPaymentIntent({
        amount: cardAlloc.cents,
        currency: 'usd',
        customer: customerId,
        payment_method: pmId,
        off_session: true,
        confirm: true,
        description: metadata.description || `Clemson RIDES ${kind}`,
        metadata: {
          ...stringifyMeta(metadata),
          kind,
          tripId: tripId || '',
          riderId: riderId || '',
        },
      }, cardIntentKey(idempotencyKey, chargeAttempt)
        ? { idempotencyKey: cardIntentKey(idempotencyKey, chargeAttempt) }
        : undefined)

      if (isOpenPaymentIntent(paymentIntent.status)) {
        if (creditsDebited && riderId) {
          await io.applyCredits(riderId, creditsDebited, {
            kind: `${kind}_reversal`,
            tripId,
            idempotencyKey: creditKey ? `${creditKey}:reverse` : null,
          })
          creditsDebited = 0
        }
        return recordOpenIntent(io, paymentIntent, {
          tripId, riderId, kind, amount, idempotencyKey, metadata, hold,
          creditsBalanceCents: creditState.balanceCents,
        })
      }
      if (!isPaidPaymentIntent(paymentIntent.status)) {
        throw Object.assign(new Error(`Payment status ${paymentIntent.status}`), { code: 'card_declined' })
      }
    }

    const recorded = await io.insertPayment({
      trip_id: tripId,
      rider_id: riderId,
      kind,
      amount_cents: amount,
      status: 'succeeded',
      stripe_payment_intent_id: paymentIntent?.id || (creditsDebited ? `credits:${idempotencyKey || riderId}` : null),
      idempotency_key: idempotencyKey,
      metadata: {
        ...metadata,
        logical_kind: kind,
        credits_applied_cents: plan.creditsAppliedCents,
        card_charged_cents: plan.cardCents,
      },
    })
    if (hold && tripId) {
      await io.clearHold(tripId, { farePaidDelta: isFareKind(kind) ? amount : 0 })
    }
    const method = plan.cardCents && plan.creditsAppliedCents ? 'credits+card' : plan.cardCents ? 'card' : 'credits'
    return {
      ok: true,
      status: 'succeeded',
      method,
      amountCents: amount,
      creditsAppliedCents: plan.creditsAppliedCents,
      cardChargedCents: plan.cardCents,
      paymentId: recorded.id,
      paymentIntentId: paymentIntent?.id || null,
      kind,
    }
  } catch (err) {
    if (creditsDebited && riderId) {
      await io.applyCredits(riderId, creditsDebited, {
        kind: `${kind}_reversal`,
        tripId,
        idempotencyKey: creditKey ? `${creditKey}:reverse` : null,
      })
    }
    const code = classifyStripeError(err)
    const failure = failureResult(code, {
      amountCents: amount,
      creditsBalanceCents: creditState.balanceCents,
      creditsReleased: creditsDebited > 0,
      kind,
      tripId,
    })
    if (code === 'authentication_required') {
      failure.clientSecret = err?.payment_intent?.client_secret || err?.raw?.payment_intent?.client_secret || null
      failure.paymentIntentId = err?.payment_intent?.id || err?.raw?.payment_intent?.id || null
    }
    console.error('[collectPayment]', code, err?.message || err, { tripId, riderId, kind, amount })
    if (hold && tripId) await io.setHold(tripId, failure)
    const stripeIntentId = err?.payment_intent?.id || err?.raw?.payment_intent?.id || null
    await io.insertPayment({
      trip_id: tripId,
      rider_id: riderId,
      kind,
      amount_cents: amount,
      status: 'failed',
      stripe_payment_intent_id: stripeIntentId,
      idempotency_key: stripeIntentId ? idempotencyKey : null,
      metadata: { ...metadata, logical_kind: kind, code },
    })
    return failure
  }
}

async function succeededChargeWasCanceled(io, existing, existingPaymentIntentId) {
  const rowPi = existing?.paymentIntentId || existing?.stripe_payment_intent_id || null
  if (existingPaymentIntentId && rowPi && existingPaymentIntentId !== rowPi) return true
  const livePi = existingPaymentIntentId || rowPi
  if (!livePi || !String(livePi).startsWith('pi_') || !io.retrievePaymentIntent) return false
  try {
    const pi = await io.retrievePaymentIntent(livePi)
    return pi?.status === 'canceled'
  } catch {
    return false
  }
}

async function lookupExistingIntent(io, { idempotencyKey, existingPaymentIntentId, amountCents }) {
  let paymentIntentId = existingPaymentIntentId || null
  if (!paymentIntentId && idempotencyKey && io.findPaymentIntent) {
    const row = await io.findPaymentIntent(idempotencyKey)
    paymentIntentId = row?.paymentIntentId || null
  }
  if (!paymentIntentId) return { action: 'create' }
  return resolveExistingPaymentIntent({
    retrieve: io.retrievePaymentIntent,
    update: io.updatePaymentIntent,
    paymentIntentId,
    amountCents,
  })
}

async function recordPaidIntent(io, pi, fields) {
  const { tripId, riderId, kind, amount, idempotencyKey, metadata, hold } = fields
  const recorded = await io.insertPayment({
    trip_id: tripId,
    rider_id: riderId,
    kind,
    amount_cents: amount,
    status: 'succeeded',
    stripe_payment_intent_id: pi.id,
    idempotency_key: idempotencyKey,
    metadata: { ...(metadata || {}), logical_kind: kind, stripe_status: pi.status, idempotent: true },
  })
  if (hold && tripId) await io.clearHold(tripId, { farePaidDelta: isFareKind(kind) ? amount : 0 })
  return {
    ok: true,
    status: 'succeeded',
    idempotent: true,
    method: 'idempotent',
    amountCents: amount,
    creditsAppliedCents: 0,
    cardChargedCents: 0,
    paymentId: recorded.id,
    paymentIntentId: pi.id,
    kind,
  }
}

async function recordOpenIntent(io, pi, fields) {
  const { tripId, riderId, kind, amount, idempotencyKey, metadata, hold, creditsBalanceCents } = fields
  const code = openIntentCode(pi.status)
  const failure = failureResult(code, {
    amountCents: amount,
    creditsBalanceCents,
    kind,
    tripId,
  })
  failure.clientSecret = pi.client_secret || null
  failure.paymentIntentId = pi.id
  failure.reused = true
  if (hold && tripId) await io.setHold(tripId, failure)
  await io.insertPayment({
    trip_id: tripId,
    rider_id: riderId,
    kind,
    amount_cents: amount,
    status: pi.status || 'pending',
    stripe_payment_intent_id: pi.id,
    idempotency_key: idempotencyKey,
    metadata: { ...(metadata || {}), logical_kind: kind, stripe_status: pi.status },
  })
  return failure
}

function stringifyMeta(metadata) {
  const out = {}
  for (const [key, value] of Object.entries(metadata || {})) {
    if (value == null) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value)
    }
  }
  return out
}
