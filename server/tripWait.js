/**
 * Pickup wait settle + Stripe charge.
 * Fee math lives in src/lib/waitFee.js. Row transitions live in trip_wait_apply().
 *
 * Charge behavior:
 * - Trip still running (start): nothing is charged. wait_fee_cents is frozen on the row.
 * - Complete: off-session PaymentIntent for wait_fee_cents only (airport deposit is separate).
 *   splitPlatformCut keeps 20% platform / 80% driver of that wait fee.
 * - Driver wait-cancel (5:00–7:00): charge the accrued wait fee only. No $1 cancel fee.
 *   Same 20/80 split. Driver does not keep 100% of the wait.
 * - Auto-cancel at 7:00: charge $4 wait + $1 cancel = $5. That gross is the 20% package:
 *   platform $1, driver $4 (driver keeps the full wait fee only in this case).
 * - No saved card, or Stripe not configured: trip still settles and payments rows
 *   are stored as pending. The fee is owed; nothing is marked succeeded.
 */
import { ensureStripeCustomer, stripeClient, stripeOk } from './friendRideLib.js'
import { quoteWait } from '../src/lib/waitFee.js'
import { reuseStoredIntent, waitChargeKey } from './chargeIdempotency.js'

const ACTIONS = new Set(['arrive', 'tick', 'cancel', 'start', 'complete'])

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

function mapRpcError(error) {
  const msg = error?.message || 'Wait update failed'
  if (/trip_not_found/i.test(msg)) return httpError('Trip not found', 404)
  if (/forbidden/i.test(msg)) return httpError('Not allowed on this trip', 403)
  if (/wait_cancel_too_early/i.test(msg)) {
    return httpError('Cancel ride opens after 5 minutes of waiting', 409)
  }
  if (/invalid_status/i.test(msg)) return httpError('Trip is not in a waiting state', 409)
  if (/bad_action/i.test(msg)) return httpError('Unknown wait action', 400)
  return httpError(msg, 500)
}

export function assertAction(action, tripId) {
  if (!ACTIONS.has(action)) throw httpError('Unknown wait action', 400)
  if (!tripId || typeof tripId !== 'string' || !tripId.trim()) throw httpError('tripId required', 400)
}

async function loadPayments(sb, tripId) {
  const { data, error } = await sb
    .from('payments')
    .select('id, kind, status, amount_cents, stripe_payment_intent_id')
    .eq('trip_id', tripId)
    .in('kind', ['wait_fee', 'cancel_fee'])
  if (error) throw httpError(error.message, 500)
  return data || []
}

async function upsertPayment(sb, row) {
  const { data: existing, error } = await sb
    .from('payments')
    .select('id, status')
    .eq('trip_id', row.trip_id)
    .eq('kind', row.kind)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw httpError(error.message, 500)
  const prev = existing?.[0]
  if (prev?.status === 'succeeded') return { ...prev, skipped: true }
  if (prev?.id) {
    const { error: upErr } = await sb
      .from('payments')
      .update({
        amount_cents: row.amount_cents,
        status: row.status,
        stripe_payment_intent_id: row.stripe_payment_intent_id,
      })
      .eq('id', prev.id)
    if (upErr) throw httpError(upErr.message, 500)
    return { id: prev.id, ...row }
  }
  const { data, error: insErr } = await sb.from('payments').insert(row).select('id').single()
  if (insErr) throw httpError(insErr.message, 500)
  return data
}

/**
 * Idempotent off-session charge of the settled wait + cancel fees.
 * One PaymentIntent for the rider total; ledger rows split wait vs cancel
 * so the $1 platform fee is visible as kind=cancel_fee.
 */
export async function chargeWaitFees(sb, trip) {
  if (!trip || typeof trip !== 'object' || !trip.id) {
    return { status: 'skipped', reason: 'nothing_to_charge', amountCents: 0 }
  }

  const waitFee = Math.max(0, Math.round(Number(trip.wait_fee_cents) || 0))
  const cancelFee = trip.status === 'cancelled_wait' ? Math.max(0, Math.round(Number(trip.cancel_fee_cents) || 0)) : 0
  const amount = waitFee + cancelFee
  const billable = trip.status === 'cancelled_wait' || (trip.status === 'completed' && waitFee > 0)
  if (!billable || amount <= 0) {
    return { status: 'skipped', reason: 'nothing_to_charge', amountCents: 0 }
  }

  const prior = await loadPayments(sb, trip.id)
  const paid = prior
    .filter((p) => p.status === 'succeeded')
    .reduce((sum, p) => sum + (Number(p.amount_cents) || 0), 0)
  if (paid >= amount) {
    return { status: 'succeeded', reason: 'already_paid', amountCents: paid }
  }

  const { data: profile, error: profileErr } = await sb
    .from('profiles')
    .select('id, email, full_name, stripe_customer_id, stripe_default_pm_id')
    .eq('id', trip.rider_id)
    .maybeSingle()
  if (profileErr) throw httpError(profileErr.message, 500)

  const stripe = stripeOk() ? stripeClient() : null
  const canCharge = Boolean(stripe && profile?.stripe_default_pm_id && profile?.stripe_customer_id)
  if (!canCharge) {
    if (waitFee > 0) {
      await upsertPayment(sb, {
        trip_id: trip.id,
        rider_id: trip.rider_id,
        kind: 'wait_fee',
        amount_cents: waitFee,
        status: 'pending',
        stripe_payment_intent_id: null,
      })
    }
    if (cancelFee > 0) {
      await upsertPayment(sb, {
        trip_id: trip.id,
        rider_id: trip.rider_id,
        kind: 'cancel_fee',
        amount_cents: cancelFee,
        status: 'pending',
        stripe_payment_intent_id: null,
      })
    }
    return {
      status: 'pending',
      reason: stripe ? 'no_card' : 'stripe_unconfigured',
      amountCents: amount,
      waitFeeCents: waitFee,
      cancelFeeCents: cancelFee,
    }
  }

  let customerId = profile.stripe_customer_id
  try {
    customerId = await ensureStripeCustomer(stripe, sb, profile)
  } catch {
    customerId = profile.stripe_customer_id
  }

  const reason = trip.wait_cancel_reason || (trip.status === 'completed' ? 'complete' : 'wait')
  const inflightId = [...prior].reverse().find((row) => (
    row.status !== 'succeeded'
    && row.stripe_payment_intent_id
    && String(row.stripe_payment_intent_id).startsWith('pi_')
  ))?.stripe_payment_intent_id || null
  const chargeKey = waitChargeKey(trip.id, trip.rider_id)
  const reused = await reuseStoredIntent(stripe, inflightId, amount)
  if (reused.action === 'already_paid' || reused.action === 'return') {
    const pi = reused.paymentIntent
    const status = reused.action === 'already_paid' ? 'succeeded' : 'pending'
    if (waitFee > 0) {
      await upsertPayment(sb, {
        trip_id: trip.id,
        rider_id: trip.rider_id,
        kind: 'wait_fee',
        amount_cents: waitFee,
        status,
        stripe_payment_intent_id: pi.id,
      })
    }
    if (cancelFee > 0) {
      await upsertPayment(sb, {
        trip_id: trip.id,
        rider_id: trip.rider_id,
        kind: 'cancel_fee',
        amount_cents: cancelFee,
        status,
        stripe_payment_intent_id: pi.id,
      })
    }
    return {
      status,
      paymentIntentId: pi.id,
      amountCents: amount,
      waitFeeCents: waitFee,
      cancelFeeCents: cancelFee,
      platformFeeCents: Number(trip.platform_fee_cents) || 0,
    }
  }
  const attempt = reused.action === 'create_attempt' ? reused.attempt : null
  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount,
        currency: 'usd',
        customer: customerId,
        payment_method: profile.stripe_default_pm_id,
        off_session: true,
        confirm: true,
        description: cancelFee > 0
          ? 'Clemson RIDES wait time + cancellation'
          : 'Clemson RIDES wait time',
        metadata: {
          tripId: String(trip.id),
          riderId: String(trip.rider_id),
          kind: cancelFee > 0 ? 'wait_cancel' : 'wait_fee',
          waitFeeCents: String(waitFee),
          cancelFeeCents: String(cancelFee),
          platformFeeCents: String(trip.platform_fee_cents || 0),
          reason: String(reason),
        },
      },
      { idempotencyKey: attempt ? `${chargeKey}:${attempt}` : chargeKey },
    )
    const status = pi.status === 'succeeded' ? 'succeeded' : 'pending'
    if (waitFee > 0) {
      await upsertPayment(sb, {
        trip_id: trip.id,
        rider_id: trip.rider_id,
        kind: 'wait_fee',
        amount_cents: waitFee,
        status,
        stripe_payment_intent_id: pi.id,
      })
    }
    if (cancelFee > 0) {
      await upsertPayment(sb, {
        trip_id: trip.id,
        rider_id: trip.rider_id,
        kind: 'cancel_fee',
        amount_cents: cancelFee,
        status,
        stripe_payment_intent_id: pi.id,
      })
    }
    return {
      status,
      paymentIntentId: pi.id,
      amountCents: amount,
      waitFeeCents: waitFee,
      cancelFeeCents: cancelFee,
      platformFeeCents: Number(trip.platform_fee_cents) || 0,
    }
  } catch (err) {
    const message = err?.message || 'Card charge failed'
    if (waitFee > 0) {
      await upsertPayment(sb, {
        trip_id: trip.id,
        rider_id: trip.rider_id,
        kind: 'wait_fee',
        amount_cents: waitFee,
        status: 'failed',
        stripe_payment_intent_id: err?.payment_intent?.id || null,
      })
    }
    if (cancelFee > 0) {
      await upsertPayment(sb, {
        trip_id: trip.id,
        rider_id: trip.rider_id,
        kind: 'cancel_fee',
        amount_cents: cancelFee,
        status: 'failed',
        stripe_payment_intent_id: err?.payment_intent?.id || null,
      })
    }
    return {
      status: 'failed',
      error: message,
      amountCents: amount,
      waitFeeCents: waitFee,
      cancelFeeCents: cancelFee,
    }
  }
}

export async function applyTripWait(sb, { action, tripId, actorId }) {
  assertAction(action, tripId)
  if (!actorId || typeof actorId !== 'string' || !actorId.trim()) throw httpError('Sign in required', 401)

  const { data, error } = await sb.rpc('trip_wait_apply', {
    p_trip_id: tripId,
    p_action: action,
    p_actor: actorId,
  })
  if (error) throw mapRpcError(error)
  const trip = data?.trip
  if (!trip?.id) throw httpError('Wait update returned no trip', 500)

  let charge = null
  if (data.should_charge) {
    charge = await chargeWaitFees(sb, trip)
  }

  const serverNow = data?.server_now || new Date().toISOString()
  const parsedServerMs = new Date(serverNow).getTime()
  const serverMs = Number.isFinite(parsedServerMs) ? parsedServerMs : Date.now()
  const quote = quoteWait(trip.arrived_at, serverMs)
  return { trip, serverNow, quote, charge }
}
