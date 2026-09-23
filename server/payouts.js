/**
 * Driver payout queue. Amounts use metadata.driver_net_cents when the rates
 * work has already split the fare; otherwise the shared 20% helper.
 * Failures stay pending and retry on backoff. They are surfaced in earnings.
 */
import { applyPayoutAttempt, payoutIsDue, resolveDriverNetCents } from '../shared/paymentFailure.js'

export function buildPayoutRecord(trip) {
  const amountCents = resolveDriverNetCents(trip)
  return {
    tripId: trip.id,
    driverId: trip.driver_id,
    amountCents,
    status: amountCents === 0 ? 'paid' : 'pending',
    pending: amountCents !== 0,
    attempts: 0,
    lastError: null,
    nextRetryAt: null,
    stripeTransferId: null,
  }
}

export async function attemptDriverPayout({ trip, stripe, connectAccountId, now = Date.now() }) {
  const existing = trip?.metadata?.payout || buildPayoutRecord(trip)
  const amountCents = existing.amountCents ?? resolveDriverNetCents(trip)
  if (!amountCents) {
    const paid = applyPayoutAttempt(existing, { ok: true, now, amountCents: 0, transferId: null })
    return { ok: true, payout: { ...paid, amountCents: 0 }, zero: true }
  }
  if (existing.status === 'paid') return { ok: true, payout: existing, idempotent: true }
  if (!payoutIsDue(existing.status === 'pending' || existing.status === 'failed' ? existing : { ...existing, status: 'pending' }, now) && existing.attempts > 0) {
    return { ok: false, payout: existing, skipped: true, reason: 'not_due' }
  }
  if (!connectAccountId) {
    const payout = applyPayoutAttempt(existing, {
      ok: false,
      error: 'no_connect_account',
      now,
      amountCents,
    })
    console.error('[payout]', { tripId: trip.id, attempt: payout.attempts, error: payout.lastError })
    return { ok: false, payout }
  }
  try {
    if (!stripe?.transfers?.create) throw new Error('Stripe transfers unavailable')
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: 'usd',
      destination: connectAccountId,
      transfer_group: trip.id,
      metadata: { tripId: trip.id, driverId: trip.driver_id || '' },
    }, { idempotencyKey: `payout:${trip.id}:${existing.attempts || 0}` })
    const payout = applyPayoutAttempt(existing, {
      ok: true,
      now,
      amountCents,
      transferId: transfer.id,
    })
    return { ok: true, payout }
  } catch (err) {
    const payout = applyPayoutAttempt(existing, {
      ok: false,
      error: err?.message || 'payout_failed',
      now,
      amountCents,
    })
    console.error('[payout]', { tripId: trip.id, attempt: payout.attempts, error: payout.lastError })
    return { ok: false, payout }
  }
}

export async function writePayout(sb, trip, payout) {
  if (!sb || !trip?.id) return { error: 'no_trip' }
  let metadata = { ...(trip.metadata || {}) }
  const fresh = await sb.from('trips').select('metadata').eq('id', trip.id).maybeSingle()
  if (!fresh.error && fresh.data?.metadata && typeof fresh.data.metadata === 'object') {
    metadata = { ...fresh.data.metadata }
  }
  metadata = { ...metadata, payout: { ...payout, tripId: trip.id } }
  const { error } = await sb.from('trips').update({ metadata }).eq('id', trip.id)
  if (error) {
    console.error('[payout] persist', error.message)
    return { error: error.message }
  }
  const row = {
    trip_id: trip.id,
    driver_id: trip.driver_id,
    amount_cents: payout.amountCents,
    status: payout.status,
    attempts: payout.attempts || 0,
    last_error: payout.lastError || null,
    next_retry_at: payout.nextRetryAt || null,
    stripe_transfer_id: payout.stripeTransferId || null,
    updated_at: new Date().toISOString(),
  }
  const saved = await sb.from('driver_payouts').upsert(row, { onConflict: 'trip_id' })
  if (saved.error && !/relation|does not exist|schema cache/i.test(saved.error.message || '')) {
    console.error('[payout] queue table', saved.error.message)
  }
  return { error: null, metadata }
}

export async function enqueueAndAttemptPayout({ sb, stripe, trip, connectAccountId, now }) {
  const record = trip?.metadata?.payout?.status ? trip.metadata.payout : buildPayoutRecord(trip)
  const nextTrip = { ...trip, metadata: { ...(trip.metadata || {}), payout: record } }
  const result = await attemptDriverPayout({ trip: nextTrip, stripe, connectAccountId, now })
  await writePayout(sb, trip, result.payout)
  return result
}

export async function loadConnectAccount(sb, driverId) {
  if (!sb || !driverId) return null
  const rich = await sb.from('profiles').select('stripe_account_id, stripe_connect_id').eq('id', driverId).maybeSingle()
  if (!rich.error && rich.data) {
    return rich.data.stripe_account_id || rich.data.stripe_connect_id || null
  }
  return null
}
