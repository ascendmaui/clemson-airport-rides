/**
 * Shared checkout reconciliation logic.
 *
 * Marks airport deposit Checkout sessions as paid idempotently:
 * records deposit in payments, stamps checkout_deposit on trip metadata,
 * restores canceled trips back to searching/scheduled, and triggers
 * rider referral social grants.
 */
import { splitPlatformFee } from '../src/lib/fareRates.js'
import { debitLots, insertChargePayment } from './creditLots.js'
import { grantRiderSocialForTrip } from './riderReferral.js'
import { restoreLiveTripAfterDeposit } from './abandonedCheckout.js'

/**
 * Inserts the deposit payment row and updates trip metadata idempotently.
 * A second call with the same session or payment_intent will not double-insert
 * into payments or double-increment fare_paid_cents.
 */
export async function recordDeposit(supabase, session, deps = {}) {
  if (!supabase) {
    console.warn('[checkout-reconcile] SUPABASE_SERVICE_ROLE_KEY missing — skip payments insert')
    return { skipped: true, reason: 'no_service_role' }
  }

  const tripId = session?.metadata?.tripId
  let riderId = session?.metadata?.riderId
  if (!riderId && tripId) {
    const { data: t } = await supabase.from('trips').select('rider_id').eq('id', tripId).maybeSingle()
    if (t?.rider_id) riderId = t.rider_id
  }

  if (!tripId || !riderId) {
    console.warn('[checkout-reconcile] missing metadata.tripId/riderId — skip insert', session?.metadata)
    return { skipped: true, reason: 'missing_metadata' }
  }

  const amount = Number(session.amount_total) || Number(session.metadata?.depositCents) || 0
  const piId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || session.id

  let alreadyRecorded = false

  if (piId) {
    const { data: existing } = await supabase
      .from('payments')
      .select('id, stripe_payment_intent_id, status')
      .eq('stripe_payment_intent_id', piId)
      .maybeSingle()
    if (existing?.id) alreadyRecorded = true
  }

  if (!alreadyRecorded && session?.id && session.id !== piId) {
    const { data: existing } = await supabase
      .from('payments')
      .select('id, stripe_payment_intent_id, status')
      .eq('stripe_payment_intent_id', session.id)
      .maybeSingle()
    if (existing?.id) alreadyRecorded = true
  }

  if (!alreadyRecorded && tripId) {
    const { data: existing } = await supabase
      .from('payments')
      .select('id, stripe_payment_intent_id, status')
      .eq('trip_id', tripId)
      .eq('kind', 'deposit')
      .eq('status', 'succeeded')
      .maybeSingle()
    if (existing?.id) alreadyRecorded = true
  }

  if (!alreadyRecorded) {
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
    if (error) {
      if (/duplicate|unique/i.test(error.message || '')) {
        alreadyRecorded = true
      } else {
        console.error('[checkout-reconcile] payments insert', error)
        return { ok: false, error: error.message }
      }
    }
  }

  const { data: trip } = await supabase.from('trips').select('id, metadata').eq('id', tripId).maybeSingle()
  const meta = trip?.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
  const debits = Array.isArray(meta.pending_credit_debits) ? meta.pending_credit_debits : []
  const nextMeta = { ...meta }
  let tripNeedsUpdate = false

  if (!alreadyRecorded && amount > 0) {
    nextMeta.fare_paid_cents = Math.max(0, Math.round(Number(meta.fare_paid_cents) || 0) + amount)
    tripNeedsUpdate = true
  }

  // Happy-path paid marker for the driver match gate (restore path also stamps this).
  if (!nextMeta.checkout_deposit || typeof nextMeta.checkout_deposit !== 'object') {
    nextMeta.checkout_deposit = { session_id: session?.id || null, at: new Date().toISOString() }
    tripNeedsUpdate = true
  }

  if (!alreadyRecorded && debits.length && !meta.credits_applied) {
    const credits = debits.reduce((sum, d) => sum + (Number(d.debitCents) || 0), 0)
    const debitLotsFn = deps.debitLots || debitLots
    await debitLotsFn(supabase, {
      profileId: riderId,
      debits,
      note: `airport-deposit:${session.id}`,
      tripId,
    })
    if (credits > 0) {
      const insertChargeFn = deps.insertChargePayment || insertChargePayment
      await insertChargeFn(supabase, {
        riderId,
        tripId,
        kind: 'ride_fare',
        amountCents: credits,
        metadata: { method: 'credits', checkout_session: session.id },
      })
    }
    nextMeta.credits_applied = true
    nextMeta.pending_credit_debits = []
    tripNeedsUpdate = true
  }

  if (trip && tripNeedsUpdate) {
    await supabase.from('trips').update({ metadata: nextMeta }).eq('id', tripId)
  }

  return { ok: true, alreadyRecorded }
}

/**
 * Performs all post-deposit side effects:
 * 1. recordDeposit (payments row, fare_paid_cents, checkout_deposit stamp, credits)
 * 2. restoreLiveTripAfterDeposit (restores searching / scheduled if abandoned)
 * 3. grantRiderSocialForTrip (referral grant)
 */
export async function applyPaidCheckoutSession(serviceClient, session, deps = {}) {
  if (!serviceClient) {
    console.warn('[checkout-reconcile] SUPABASE_SERVICE_ROLE_KEY missing — skip payments insert')
    return {
      ok: true,
      skipped: true,
      reason: 'no_service_role',
      recorded: { skipped: true, reason: 'no_service_role' },
      live: null,
      referral: null,
      alreadyRecorded: false,
    }
  }

  if (session?.metadata?.kind === 'credit_purchase') {
    return {
      ok: true,
      skipped: true,
      reason: 'credit_purchase',
      alreadyRecorded: false,
    }
  }

  const recordDepositFn = deps.recordDeposit || recordDeposit
  const recorded = await recordDepositFn(serviceClient, session, deps)
  if (!recorded.ok && !recorded.skipped) {
    return {
      ok: false,
      error: recorded.error,
      recorded,
      live: null,
      referral: null,
      alreadyRecorded: false,
    }
  }

  const paid = session?.payment_status === 'paid'
    || session?.payment_status === 'no_payment_required'
    || deps.isAsyncPaymentSucceeded === true

  let live = null
  if (paid) {
    const restoreFn = deps.restoreLiveTripAfterDeposit || restoreLiveTripAfterDeposit
    live = await restoreFn(serviceClient, session)
  }

  let referral = null
  const tripId = session?.metadata?.tripId
  if (tripId) {
    const grantFn = deps.grantRiderSocialForTrip || grantRiderSocialForTrip
    referral = await grantFn(serviceClient, tripId)
  }

  return {
    ok: true,
    paid,
    alreadyRecorded: Boolean(recorded?.alreadyRecorded),
    tripId: tripId || null,
    recorded,
    live,
    referral,
  }
}

/**
 * Reconciles a Checkout Session on demand:
 * - Validates sessionId format (cs_...)
 * - Retrieves Checkout Session from Stripe
 * - Verifies session.metadata.tripId belongs to userId
 * - Skips credit_purchase sessions
 * - If unpaid: returns { ok: true, paid: false, tripId } with no writes
 * - If paid: applies paid deposit side effects idempotently and returns { ok, paid, alreadyRecorded, tripId }
 */
export async function reconcileCheckoutSession(
  { stripe, sb, sessionId, userId, ...inlineDeps } = {},
  extraDeps = {}
) {
  const deps = { ...inlineDeps, ...extraDeps }

  if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_') || sessionId.length <= 3) {
    return { ok: false, error: 'invalid_session_id', status: 400, reason: 'bad_id' }
  }

  if (!stripe?.checkout?.sessions?.retrieve) {
    return { ok: false, error: 'stripe_client_required', status: 500 }
  }

  let session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch (err) {
    return { ok: false, error: err?.message || 'stripe_retrieve_error', status: 502, reason: 'stripe_retrieve_error' }
  }

  if (!session) {
    return { ok: false, error: 'session_not_found', status: 404, reason: 'not_found' }
  }

  if (session?.metadata?.kind === 'credit_purchase') {
    return { ok: true, skipped: true, paid: false, reason: 'credit_purchase' }
  }

  const tripId = session?.metadata?.tripId
  if (!tripId) {
    return { ok: false, error: 'missing_trip_metadata', status: 400, reason: 'missing_trip_metadata' }
  }

  if (!sb) {
    return { ok: false, error: 'database_client_required', status: 500 }
  }

  const { data: trip, error: tripErr } = await sb
    .from('trips')
    .select('id, rider_id, status, metadata')
    .eq('id', tripId)
    .maybeSingle()

  if (tripErr) {
    return { ok: false, error: tripErr.message, status: 500 }
  }

  if (!trip) {
    return { ok: false, error: 'trip_not_found', status: 404, reason: 'trip_not_found' }
  }

  if (!userId || trip.rider_id !== userId) {
    return { ok: false, error: 'forbidden', status: 403, reason: 'forbidden' }
  }

  const isPaid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required'
  if (!isPaid) {
    return { ok: true, paid: false, tripId }
  }

  const applied = await applyPaidCheckoutSession(sb, session, deps)
  if (!applied.ok && !applied.skipped) {
    return { ok: false, error: applied.error, status: 500, tripId }
  }

  return {
    ok: true,
    paid: true,
    alreadyRecorded: Boolean(applied.alreadyRecorded),
    tripId,
  }
}
