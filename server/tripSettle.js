/**
 * Blocks complete/cancel until collectPayment succeeds, except a real $0 due
 * or an admin override. Fee amounts are inputs — this does not invent
 * wait-minute or cancellation percentages.
 */
import { collectPayment, clearPaymentHold } from './collectPayment.js'
import { enqueueAndAttemptPayout, loadConnectAccount } from './payouts.js'
import {
  amountDueForAction,
  failureResult,
  paidTowardFareCents,
  progressionGate,
  readPrecomputedFeeCents,
} from '../shared/paymentFailure.js'
import { serverIsAdmin } from './adminRoster.js'
import { ensureAuthoritativeFare, storedFareCents } from './authoritativeFare.js'
import { farePaidCents, tripChargeKey, waitFeeBilledCents } from './chargeIdempotency.js'
import { insertTripEvent } from './tripEvents.js'
import { debitStoredRideCredits } from './rideCreditSettle.js'
import { airportDepositRequiredCents } from '../packages/rides-native/tripTags.js'
import { releaseTigerHeatReservation, settleTigerHeatReservation } from './tigerHeatService.js'
import { releaseOpenFareHold, settleFareHold } from './fareAuthorization.js'
import { riderCaptureFareCents } from '../shared/backupDriverQueue.js'
import { claimCompletion, completionResult, releaseCompletion } from './tripCompletion.js'
import { readBoostCents } from '../shared/scheduledBoost.js'
import { allStopsDone, stopFlowStarted, tripStops } from '../shared/carpoolStops.js'

function stopsPendingResult() {
  return { http: 409, body: { error: 'Finish every stop before completing this carpool.', code: 'stops_pending', progressed: false } }
}

/** Carpool stop flow started and a pickup or drop-off is still open. */
function stopsPending(trip) {
  return stopFlowStarted(trip) && !allStopsDone(tripStops(trip))
}

const ACTIVE_KEEP = new Set(['accepted', 'arriving', 'in_progress', 'payment_required', 'searching', 'offered'])

export function isAdminUser(user, profile) {
  return serverIsAdmin({
    jwtEmail: user?.email,
    profileEmail: profile?.email,
    role: profile?.role,
    isAdmin: profile?.is_admin,
  })
}

function feeKindFor(action, requested) {
  if (requested) return requested
  if (action === 'cancel') return 'cancel_fee'
  if (action === 'charge') return 'mid_ride'
  return 'balance'
}

/**
 * True when this rider has a saved card. null means the profile could not be read,
 * so the caller keeps the existing charge path.
 */
async function savedCardOnFile({ deps, sb, riderId }) {
  if (!riderId) return false
  try {
    if (typeof deps?.loadProfile === 'function') {
      const profile = await deps.loadProfile(riderId)
      return Boolean(profile?.stripe_default_pm_id)
    }
    if (!sb) return null
    const loaded = await sb.from('profiles').select('stripe_default_pm_id').eq('id', riderId).maybeSingle()
    if (loaded.error) return null
    return Boolean(loaded.data?.stripe_default_pm_id)
  } catch {
    return null
  }
}

export async function settleTrip({
  sb,
  stripe,
  trip,
  payments = [],
  action,
  explicitAmountCents = null,
  feeKind = null,
  requireFee = false,
  adminOverride = false,
  methods = ['credits', 'card'],
  paymentMethodId = null,
  actor = null,
  deps = null,
}) {
  if (!trip?.id) return { http: 404, body: { error: 'Trip not found' } }
  if (action !== 'complete' && action !== 'cancel' && action !== 'charge') {
    return { http: 400, body: { error: 'action must be complete, cancel, or charge' } }
  }

  let profile = null
  if (sb && actor?.id) {
    const loaded = await sb.from('profiles').select('id, email, role').eq('id', actor.id).maybeSingle()
    if (!loaded.error) profile = loaded.data
  }
  const override = Boolean(adminOverride) && isAdminUser(actor, profile)
  if (adminOverride && !override) {
    return { http: 403, body: { error: 'Admin override is not available for this account' } }
  }

  if (action === 'complete') {
    const result = completionResult(trip, actor, override)
    if (result) return result
    // Carpool stop flow: every pickup and drop-off is resolved before the
    // pool completes. Builds without the stop list never start it.
    if (!override && stopsPending(trip)) return stopsPendingResult()
  }

  if (action === 'complete' && storedFareCents(trip) == null) {
    const ensured = await ensureAuthoritativeFare({ sb, trip })
    if (ensured.error || storedFareCents(ensured.trip) == null) {
      return {
        http: ensured.status || 409,
        body: {
          error: ensured.error || 'Fare is not set. This trip cannot settle at $0.',
          code: 'fare_not_set',
          progressed: false,
        },
      }
    }
    trip = ensured.trip
  }

  let completionClaim = null
  if (action === 'complete') {
    const claimed = await claimCompletion(sb, trip.id, actor, override)
    if (claimed.result) return claimed.result
    trip = claimed.trip
    completionClaim = claimed.claim
    // Re-check stops on the claimed row: a stop may have changed since the first read.
    if (!override && stopsPending(trip)) {
      await releaseCompletion(sb, trip.id, completionClaim)
      return stopsPendingResult()
    }
  }
  const result = await settleClaimedTrip({
    sb, stripe, trip, payments, action, explicitAmountCents, feeKind,
    requireFee, override, methods, paymentMethodId, actor, deps, completionClaim,
  })
  if (completionClaim && result.http !== 200 && result.http < 500) {
    await releaseCompletion(sb, trip.id, completionClaim)
  }
  return result
}

async function settleClaimedTrip({
  sb, stripe, trip, payments, action, explicitAmountCents, feeKind,
  requireFee, override, methods, paymentMethodId, actor, deps, completionClaim,
}) {
  const kind = feeKindFor(action, feeKind)
  const precomputed = explicitAmountCents == null ? readPrecomputedFeeCents(trip, kind) : null
  const due = amountDueForAction({
    action,
    fareCents: action === 'complete' ? riderCaptureFareCents(trip) : trip.fare_cents,
    paidCents: paidTowardFareCents(trip, payments),
    hold: trip.metadata?.payment_hold || null,
    explicitAmountCents,
    precomputedFeeCents: precomputed,
    requireFee: requireFee || action === 'charge',
  })

  if (due.code === 'fare_not_set') {
    return {
      http: 409,
      body: {
        error: 'Fare is not set. This trip cannot settle at $0.',
        code: 'fare_not_set',
        progressed: false,
      },
    }
  }

  if (due.code === 'fee_not_computed') {
    const failure = failureResult('fee_not_computed', { amountCents: 0, tripId: trip.id, kind })
    return { http: 409, body: { error: failure.message, failure, progressed: false } }
  }

  const chargeKind = action === 'complete' ? (due.kind || 'balance') : kind
  const paidCents = farePaidCents(trip)
  const depositAlreadyExists = airportDepositRequiredCents(trip) > 0
  const boostCents = action === 'complete' ? readBoostCents(trip) : 0
  const waitFeeCents = action === 'complete' ? Math.max(0, Math.round(Number(trip.wait_fee_cents) || 0)) : 0
  const waitBilledCents = waitFeeBilledCents(trip, payments)
  const waitToBillCents = Math.max(0, waitFeeCents - waitBilledCents)
  const creditsFare = action === 'complete' && trip.metadata?.billing_choice === 'credits'
  // Credits cover only the fare; boost and frozen wait fees use the card.
  const captureCents = (creditsFare ? 0 : Math.max(0, Math.round(Number(due.amountCents) || 0))) + boostCents + waitToBillCents
  const collectionCents = action === 'complete' ? captureCents : due.amountCents
  const billingMetadata = action === 'complete' ? {
    fare_billed_cents: creditsFare ? 0 : due.amountCents,
    boost_billed_cents: boostCents,
    wait_fee_billed_cents: waitToBillCents,
  } : {}
  let fareHold = null
  if (action === 'complete' && !override && (due.amountCents > 0 || captureCents > 0)) {
    try {
      fareHold = await settleFareHold({
        sb,
        stripe,
        trip,
        finalFareCents: captureCents,
        billingMetadata,
      })
    } catch (err) {
      console.error('[tripSettle] fare hold', err?.message || err)
      fareHold = failureResult('charge_failed', {
        amountCents: captureCents,
        tripId: trip.id,
        kind: 'balance',
      })
    }
  }
  const cardOnFile = depositAlreadyExists || fareHold
    ? null
    : await savedCardOnFile({ deps, sb, riderId: trip.rider_id })

  const creditsChoice = action === 'complete'
    && trip.metadata?.billing_choice === 'credits'
    && due.amountCents > 0
    && !override
  let creditsDebit = null
  if (creditsChoice) {
    const alreadyDebited = Math.max(0, Math.round(Number(trip.metadata?.billing_debited_cents) || 0))
    if (trip.metadata?.credits_settled && alreadyDebited >= due.amountCents) {
      creditsDebit = { ok: true, duplicate: true, debitedCents: alreadyDebited }
    } else {
      try {
        creditsDebit = await debitStoredRideCredits({
          sb,
          store: deps?.creditStore || null,
          riderId: trip.rider_id,
          tripId: trip.id,
          amountCents: due.amountCents,
        })
      } catch {
        creditsDebit = { ok: false, code: 'credits_unavailable', balanceCents: 0, debitedCents: 0 }
      }
    }
    if (!creditsDebit.ok) {
      const code = creditsDebit.code === 'credits_insufficient' ? 'credits_insufficient' : 'credits_unavailable'
      const failure = failureResult(code, {
        amountCents: due.amountCents,
        tripId: trip.id,
        kind: 'balance',
        creditsBalanceCents: creditsDebit.balanceCents,
      })
      return {
        http: 402,
        body: {
          error: failure.message,
          failure,
          progressed: false,
          status: 'payment_required',
          tripStatus: trip.status,
        },
      }
    }
  }

  // Campus fares have no deposit. With no saved card and no collected credits,
  // complete must not call Stripe or pay the driver. A credits debit that
  // succeeded was collected, so the driver can be paid.
  const campusUncollected = action === 'complete'
    && due.amountCents > 0
    && !override
    && !depositAlreadyExists
    && !fareHold
    && cardOnFile === false
    && !creditsDebit?.ok
    && waitToBillCents === 0
  let payment = null
  if (fareHold) {
    payment = fareHold
  } else if (creditsDebit?.ok && collectionCents === 0) {
    payment = {
      ok: true,
      method: 'credits',
      amountCents: due.amountCents,
      duplicate: Boolean(creditsDebit.duplicate),
      debitedCents: creditsDebit.debitedCents,
    }
  } else if (campusUncollected) {
    payment = {
      ok: true,
      method: 'none',
      reason: 'no_card_on_file',
      amountCents: due.amountCents,
      skipped: true,
    }
  } else if (collectionCents > 0 && !override) {
    payment = await collectPayment({
      sb,
      stripe,
      deps,
      tripId: trip.id,
      riderId: trip.rider_id,
      amountCents: collectionCents,
      methods: creditsFare ? ['card'] : methods,
      kind: chargeKind,
      idempotencyKey: tripChargeKey(trip.id, trip.rider_id, chargeKind, paidCents),
      hold: true,
      midRide: action !== 'complete' || ['accepted', 'arriving', 'in_progress'].includes(trip.status),
      paymentMethodId,
      metadata: { action, feeKind: chargeKind, ...billingMetadata },
    })
  } else if (override && due.amountCents > 0) {
    payment = await collectPayment({
      sb,
      stripe,
      deps,
      tripId: trip.id,
      riderId: trip.rider_id,
      amountCents: due.amountCents,
      kind: chargeKind,
      adminOverride: true,
      idempotencyKey: tripChargeKey(trip.id, trip.rider_id, `${chargeKind}:admin`, paidCents),
      hold: true,
    })
  }

  const gate = campusUncollected
    ? { allow: true, reason: 'no_card_on_file' }
    : progressionGate({
      amountDueCents: action === 'complete' ? due.amountCents + boostCents + waitToBillCents : due.amountCents,
      payment,
      adminOverride: override,
    })

  if (!gate.allow) {
    return {
      http: 402,
      body: {
        error: payment?.message || 'Payment required',
        failure: payment,
        progressed: false,
        status: 'payment_required',
        tripStatus: trip.status,
      },
    }
  }

  if (sb && gate.allow && !campusUncollected) {
    // A cancel that collected nothing is not "paid" (it would show up in payouts and reports).
    const nothingCollected = action === 'cancel' && !payment && !(collectionCents > 0)
    await clearPaymentHold(sb, trip.id, { farePaidDelta: 0, ...(nothingCollected ? { paymentStatus: 'no_charge' } : {}) })
  }

  if (action === 'charge') {
    return {
      http: 200,
      body: {
        ok: true,
        progressed: false,
        status: trip.status,
        payment,
        reason: gate.reason,
      },
    }
  }

  if (action === 'complete') {
    const fresh = await sb.from('trips').select('*').eq('id', trip.id).maybeSingle()
    if (fresh.error) return { http: 500, body: { error: fresh.error.message, payment, progressed: false } }
    if (!fresh.data) return { http: 404, body: { error: 'Trip not found' } }
    const result = completionResult(fresh.data, actor, override)
    if (result) return result
    if (fresh.data.metadata?.completion_claim?.token !== completionClaim.token) {
      return { http: 409, body: { code: 'completion_in_progress', progressed: false } }
    }
    trip = fresh.data
  }

  const now = new Date().toISOString()
  const patch = action === 'complete'
    ? { status: 'completed', completed_at: now }
    : { status: 'canceled', canceled_at: now }
  if (campusUncollected) {
    const metadata = { ...(trip.metadata || {}) }
    delete metadata.payment_hold
    metadata.remainder_uncollected = true
    metadata.remainder_reason = 'no_card_on_file'
    patch.metadata = metadata
  } else if (creditsDebit?.ok) {
    const metadata = { ...(trip.metadata || {}) }
    const priorPaid = Math.max(farePaidCents(trip), paidTowardFareCents(trip, payments))
    metadata.billing_debited_cents = due.amountCents
    metadata.billing_charged = false
    metadata.credits_settled = true
    metadata.fare_paid_cents = Math.max(priorPaid, paidTowardFareCents(trip, payments) + due.amountCents)
    patch.metadata = metadata
  }
  if (action === 'complete' && waitFeeCents > 0 && !override) {
    patch.metadata = {
      ...(patch.metadata || trip.metadata || {}),
      wait_fee_billed_cents: Math.min(waitFeeCents, waitBilledCents + waitToBillCents),
    }
  }

  let tigerHeat = null
  try {
    if (action === 'cancel' || (action === 'complete' && campusUncollected)) {
      tigerHeat = await releaseTigerHeatReservation({ sb, trip })
    } else if (action === 'complete') {
      tigerHeat = await settleTigerHeatReservation({ sb, trip, completedAt: now })
    }
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      msg: 'tiger_heat_settle_failed',
      tripId: trip.id,
      error: error?.message || String(error),
    }))
  }
  if (tigerHeat) {
    const metadata = { ...(patch.metadata || trip.metadata || {}) }
    metadata.tiger_heat = tigerHeat
    patch.metadata = metadata
    trip = { ...trip, metadata, status: patch.status }
  }

  if (sb) {
    let write = sb.from('trips').update(patch).eq('id', trip.id)
    if (action === 'complete') {
      write = write.eq('status', 'in_progress').eq('metadata->completion_claim->>token', completionClaim.token)
      if (!override) write = write.eq('driver_id', actor.id)
    }
    const { data, error } = action === 'complete'
      ? await write.select('id').maybeSingle()
      : await write
    if (error) return { http: 500, body: { error: error.message, payment, progressed: false } }
    if (action === 'complete' && !data) {
      const fresh = await sb.from('trips').select('*').eq('id', trip.id).maybeSingle()
      if (fresh.error) return { http: 500, body: { error: fresh.error.message, progressed: false } }
      return completionResult(fresh.data || {}, actor, override) || { http: 409, body: { code: 'invalid_status', progressed: false } }
    }
    if (action === 'cancel') await releaseOpenFareHold({ sb, stripe, trip, reason: 'settle_cancel' })
    const { error: eventError } = await insertTripEvent(sb, {
      trip_id: trip.id,
      kind: patch.status,
      payload: { source: 'trip_settle', reason: gate.reason, amount_cents: due.amountCents,
        ...(waitFeeCents > 0 ? { wait_fee_billed_cents: override ? waitBilledCents : waitFeeCents } : {}) },
    })
    if (eventError) {
      return {
        http: 500,
        body: {
          error: eventError.message || 'Could not record trip event',
          code: 'trip_event_failed',
          payment,
          progressed: true,
          status: patch.status,
        },
      }
    }
  }

  if (!sb && action === 'cancel') await releaseOpenFareHold({ sb, stripe, trip, reason: 'settle_cancel' })

  let payout = null
  // This complete did not collect the fare. A Connect transfer would pay the
  // driver for money that was never charged, and the trip is already completed.
  if (action === 'complete' && trip.driver_id && !campusUncollected) {
    const connectAccountId = sb ? await loadConnectAccount(sb, trip.driver_id) : null
    payout = await enqueueAndAttemptPayout({
      sb,
      stripe,
      trip: { ...trip, status: 'completed', metadata: trip.metadata },
      connectAccountId,
    })
  }

  return {
    http: 200,
    body: {
      ok: true,
      progressed: true,
      status: patch.status,
      reason: gate.reason,
      payment,
      payout: payout ? { ok: payout.ok, status: payout.payout?.status, lastError: payout.payout?.lastError || null, amountCents: payout.payout?.amountCents, waitCents: payout.payout?.waitCents || 0 } : null,
      keptActive: ACTIVE_KEEP.has(trip.status) && !gate.allow,
    },
  }
}
