/**
 * Stable charge identity for Stripe idempotency.
 * Keys name the ride or trip, the payer, and the purpose. They never include
 * an amount — a fare that moves during 3DS must hit the same PaymentIntent.
 */

const OPEN_STATUSES = new Set(['requires_action', 'requires_payment_method', 'requires_confirmation'])
const PAID_STATUSES = new Set(['succeeded', 'processing', 'requires_capture'])

export function friendShareChargeKey(rideId, userId) {
  return `friend_share:${rideId}:${userId}:charge`
}

/** Cents already collected on the trip. Unchanged while a PaymentIntent is still open. */
export function farePaidCents(trip) {
  const raw = trip?.metadata?.fare_paid_cents
  if (raw == null || raw === '') return 0
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.round(n))
}

/**
 * One generation per successful collection. `paidCents` is trips.metadata.fare_paid_cents
 * before this attempt, so 3DS retries share a key and the next balance due does not.
 */
export function tripChargeKey(tripId, userId, purpose, paidCents = 0) {
  const paid = Math.max(0, Math.round(Number(paidCents) || 0))
  return `trip:${tripId}:${userId}:${purpose}:paid${paid}:charge`
}

export function waitChargeKey(tripId, userId) {
  return `wait:${tripId}:${userId}:charge`
}

/** Card PaymentIntent idempotency key. Derived from the charge key; no amount. */
export function cardIntentKey(chargeKey, attempt = null) {
  if (!chargeKey) return null
  return attempt ? `${chargeKey}:card:${attempt}` : `${chargeKey}:card`
}

/** Credits ledger key. Derived from the charge key; no amount. */
export function creditsIntentKey(chargeKey, attempt = null) {
  if (!chargeKey) return null
  return attempt ? `${chargeKey}:credits:${attempt}` : `${chargeKey}:credits`
}

/** Payment Element idempotency key. Derived from the charge key; no amount. */
export function elementIntentKey(chargeKey, attempt = null) {
  if (!chargeKey) return null
  return attempt ? `${chargeKey}:element:${attempt}` : `${chargeKey}:element`
}

export function isOpenPaymentIntent(status) {
  return OPEN_STATUSES.has(status)
}

export function isPaidPaymentIntent(status) {
  return PAID_STATUSES.has(status)
}

export function classifyPaymentIntent(pi) {
  if (!pi?.status) return 'missing'
  if (PAID_STATUSES.has(pi.status)) return 'paid'
  if (pi.status === 'canceled') return 'canceled'
  if (OPEN_STATUSES.has(pi.status)) return 'open'
  return 'other'
}

/** Amount can be updated only while Stripe still has the PaymentIntent open. */
export function intentAmountUpdatable(pi) {
  return OPEN_STATUSES.has(pi?.status)
}

export function openIntentCode(status) {
  if (status === 'requires_payment_method') return 'no_payment_method'
  return 'authentication_required'
}

/**
 * Decide what to do with a PaymentIntent we already created.
 * Does not create a new one. A canceled intent returns an attempt suffix so
 * the next create uses a new Stripe idempotency key.
 */
export async function resolveExistingPaymentIntent({ retrieve, update, paymentIntentId, amountCents }) {
  if (!paymentIntentId || typeof retrieve !== 'function') return { action: 'create' }
  let pi
  try {
    pi = await retrieve(paymentIntentId)
  } catch {
    return { action: 'create' }
  }
  if (!pi) return { action: 'create' }
  const kind = classifyPaymentIntent(pi)
  if (kind === 'paid') return { action: 'already_paid', paymentIntent: pi }
  if (kind === 'canceled') {
    return { action: 'create_attempt', paymentIntent: pi, attempt: `attempt:${pi.id}` }
  }
  if (kind === 'open') {
    const serverAmount = Math.round(Number(amountCents) || 0)
    let current = pi
    if (
      serverAmount > 0
      && Number(pi.amount) !== serverAmount
      && intentAmountUpdatable(pi)
      && typeof update === 'function'
    ) {
      try {
        const updated = await update(pi.id, { amount: serverAmount })
        current = updated ? { ...pi, ...updated, id: updated.id || pi.id } : pi
        if (!current.client_secret) current.client_secret = pi.client_secret || null
      } catch {
        current = pi
      }
    }
    return { action: 'return', paymentIntent: current }
  }
  return { action: 'create', paymentIntent: pi }
}

export async function reuseStoredIntent(stripe, paymentIntentId, amountCents) {
  if (!paymentIntentId || !stripe?.paymentIntents?.retrieve) return { action: 'create' }
  return resolveExistingPaymentIntent({
    retrieve: (id) => stripe.paymentIntents.retrieve(id),
    update: stripe.paymentIntents.update
      ? (id, params) => stripe.paymentIntents.update(id, params)
      : null,
    paymentIntentId,
    amountCents,
  })
}
