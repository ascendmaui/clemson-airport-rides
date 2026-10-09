/**
 * Off-session charge for a tip the server already priced and stored.
 * No saved card means no charge. A retry uses the same idempotency key.
 */
import { stripeClient, stripeOk } from './friendRideLib.js'

export function tipChargeKey(tripId) {
  return `tip:${tripId}`
}

function processorFor(cardClient) {
  if (cardClient) return cardClient
  if (!stripeOk()) return null
  return stripeClient()
}

async function loadCard(sb, riderId) {
  try {
    const loaded = await sb
      .from('profiles')
      .select('id, stripe_customer_id, stripe_default_pm_id')
      .eq('id', riderId)
      .maybeSingle()
    if (loaded?.error) return null
    return loaded?.data || null
  } catch {
    return null
  }
}

async function findSucceededTip(sb, tripId, key) {
  try {
    const res = await sb
      .from('payments')
      .select('id, amount_cents, status, stripe_payment_intent_id, idempotency_key, kind')
      .eq('trip_id', tripId)
    if (res?.error) return null
    const rows = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : [])
    return rows.find((row) => (
      row
      && row.kind === 'tip'
      && row.status === 'succeeded'
      && (row.idempotency_key == null || row.idempotency_key === key)
    )) || null
  } catch {
    return null
  }
}

async function recordTipPayment(sb, { tripId, riderId, amountCents, paymentIntentId, key }) {
  try {
    const inserted = await sb.from('payments').insert({
      trip_id: tripId,
      rider_id: riderId,
      stripe_payment_intent_id: paymentIntentId,
      kind: 'tip',
      amount_cents: amountCents,
      status: 'succeeded',
      idempotency_key: key,
    })
    if (inserted?.error && !/duplicate|unique/i.test(inserted.error.message || '')) {
      return false
    }
    return true
  } catch (err) {
    if (/duplicate|unique/i.test(err?.message || '')) return true
    return false
  }
}

/**
 * Charge `amountCents` (already priced by the tip module) or report why not.
 * Always resolves. A missing card or a declined card does not throw.
 */
export async function chargeSavedTip({
  sb,
  cardClient = null,
  trip,
  amountCents,
  riderId,
}) {
  const cents = Math.max(0, Math.round(Number(amountCents) || 0))
  if (cents <= 0 || !trip?.id || !riderId) {
    return { ok: true, charged: false, chargeStatus: 'skipped', tipCents: 0 }
  }

  const profile = await loadCard(sb, riderId)
  const paymentMethodId = profile?.stripe_default_pm_id || null
  const customerId = profile?.stripe_customer_id || null
  if (!paymentMethodId || !customerId) {
    return { ok: true, charged: false, chargeStatus: 'no_card', tipCents: 0 }
  }

  const key = tipChargeKey(trip.id)
  const prior = await findSucceededTip(sb, trip.id, key)
  if (prior) {
    return {
      ok: true,
      charged: true,
      duplicate: true,
      chargeStatus: 'charged',
      tipCents: Math.max(0, Math.round(Number(prior.amount_cents) || cents)),
      paymentIntentId: prior.stripe_payment_intent_id || null,
    }
  }

  const processor = processorFor(cardClient)
  if (!processor?.paymentIntents?.create) {
    return { ok: true, charged: false, chargeStatus: 'unavailable', tipCents: 0 }
  }

  try {
    const pi = await processor.paymentIntents.create({
      amount: cents,
      currency: 'usd',
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      description: `Clemson RIDES tip · trip ${trip.id}`,
      metadata: {
        kind: 'tip',
        tripId: trip.id,
        riderId,
        tipCents: String(cents),
      },
    }, { idempotencyKey: key })
    if (pi?.status !== 'succeeded') {
      return {
        ok: true,
        charged: false,
        chargeStatus: 'pending',
        tipCents: 0,
        paymentIntentId: pi?.id || null,
      }
    }
    await recordTipPayment(sb, {
      tripId: trip.id,
      riderId,
      amountCents: cents,
      paymentIntentId: pi.id,
      key,
    })
    return {
      ok: true,
      charged: true,
      chargeStatus: 'charged',
      tipCents: cents,
      paymentIntentId: pi.id,
    }
  } catch {
    return { ok: true, charged: false, chargeStatus: 'declined', tipCents: 0 }
  }
}
