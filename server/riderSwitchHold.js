/**
 * Move or release the manual-capture fare hold when a rider switches
 * before pickup. A missing Stripe client skips the network call.
 */
import { fareAuthorizationCents } from '../shared/fareAuthorization.js'
import { insertPaymentRow } from './collectPayment.js'
import { releaseOpenFareHold } from './fareAuthorization.js'

function authOf(trip) {
  const auth = trip?.metadata?.fare_authorization
  return auth && typeof auth === 'object' ? auth : null
}

async function cancelIntent(stripe, paymentIntentId) {
  if (!paymentIntentId || !stripe?.paymentIntents?.cancel) return false
  try {
    await stripe.paymentIntents.cancel(paymentIntentId)
    return true
  } catch {
    return false
  }
}

async function markReleasedPayment(sb, tripId, paymentIntentId) {
  if (!sb || !tripId || !paymentIntentId) return
  const updated = await sb.from('payments').update({
    status: 'canceled',
  }).eq('trip_id', tripId).eq('stripe_payment_intent_id', paymentIntentId)
  if (updated?.error) {
    console.error('[rider-switch] payment release', updated.error.message || updated.error)
  }
}

/**
 * @returns {Promise<{ ok: boolean, patch: object | null, error?: string, code?: string }>}
 */
export async function settleSwitchHold({
  stripe,
  sb,
  trip,
  quote,
  riderId,
  customerId = null,
  paymentMethodId = null,
  fareCents = null,
} = {}) {
  const hold = quote?.hold
  const auth = authOf(trip)
  if (hold === 'keep' || hold === 'none' || !hold) {
    return { ok: true, patch: null }
  }

  if (hold === 'release') {
    const result = await releaseOpenFareHold({ stripe, sb, trip, reason: 'rider_switch' })
    if (result.released) {
      try {
        await markReleasedPayment(sb, trip?.id, auth?.paymentIntentId)
      } catch (error) {
        console.error('[rider-switch] payment release', error?.message || error)
      }
    }
    return {
      ok: true,
      patch: result.released ? { fare_authorization: trip.metadata.fare_authorization } : null,
    }
  }

  const target = fareAuthorizationCents(fareCents ?? trip?.fare_cents)
  const needed = target.authorizationCents
  if (needed <= 0) return { ok: true, patch: null }

  if (hold === 'grow' && auth?.paymentIntentId && stripe?.paymentIntents?.incrementAuthorization) {
    try {
      const incremented = await stripe.paymentIntents.incrementAuthorization(auth.paymentIntentId, { amount: needed })
      if (incremented && (incremented.status === 'requires_capture' || incremented.status === 'succeeded')) {
        return {
          ok: true,
          patch: {
            fare_authorization: {
              ...auth,
              status: incremented.status === 'succeeded' ? 'captured' : 'requires_capture',
              authorizationCents: needed,
              estimatedFareCents: target.estimatedFareCents,
              bufferCents: Math.max(0, needed - target.estimatedFareCents),
              at: new Date().toISOString(),
            },
          },
        }
      }
    } catch (err) {
      console.error('[rider-switch] increment', err?.message || err)
    }
  }

  if (hold !== 'grow' && hold !== 'place') {
    return { ok: true, patch: null }
  }

  if (!stripe?.paymentIntents?.create) {
    return { ok: true, patch: null }
  }
  if (!customerId || !paymentMethodId) {
    return {
      ok: true,
      patch: {
        outstanding_balance: {
          amountCents: target.estimatedFareCents,
          code: 'no_payment_method',
          reason: 'authorization_failed',
          at: new Date().toISOString(),
        },
      },
    }
  }

  const idempotencyKey = `fare_auth:${trip.id}:switch:${needed}`
  let created
  try {
    created = await stripe.paymentIntents.create({
      amount: needed,
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
        tripId: String(trip.id || ''),
        riderId: String(riderId || ''),
        reason: 'rider_switch',
      },
    }, { idempotencyKey })
  } catch (err) {
    console.error('[rider-switch] replace hold', err?.message || err)
    return { ok: false, patch: null, error: 'Could not update the card hold. The current driver is still on this ride.', code: 'hold_replace_failed' }
  }

  if (created?.status !== 'requires_capture' && created?.status !== 'succeeded') {
    await cancelIntent(stripe, created?.id)
    return { ok: false, patch: null, error: 'Could not update the card hold. The current driver is still on this ride.', code: 'hold_replace_failed' }
  }

  if (auth?.paymentIntentId && auth.paymentIntentId !== created.id) {
    const released = await cancelIntent(stripe, auth.paymentIntentId)
    if (!released && stripe?.paymentIntents?.cancel) {
      await cancelIntent(stripe, auth.paymentIntentId)
    }
    await markReleasedPayment(sb, trip.id, auth.paymentIntentId)
  }

  if (sb) {
    await insertPaymentRow(sb, {
      trip_id: trip.id,
      rider_id: riderId,
      kind: 'balance',
      amount_cents: needed,
      status: created.status === 'succeeded' ? 'succeeded' : 'pending',
      stripe_payment_intent_id: created.id,
      idempotency_key: idempotencyKey,
      metadata: {
        logical_kind: 'fare_authorization',
        reason: 'rider_switch',
      },
    })
  }

  return {
    ok: true,
    patch: {
      fare_authorization: {
        status: created.status === 'succeeded' ? 'captured' : 'requires_capture',
        paymentIntentId: created.id,
        authorizationCents: needed,
        estimatedFareCents: target.estimatedFareCents,
        bufferCents: Math.max(0, needed - target.estimatedFareCents),
        paymentMethodId,
        at: new Date().toISOString(),
        replacedPaymentIntentId: auth?.paymentIntentId || null,
      },
      outstanding_balance: null,
    },
  }
}
