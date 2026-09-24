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
import { isAdminIdentity } from '../shared/adminAccess.js'
import { ensureAuthoritativeFare, storedFareCents } from './authoritativeFare.js'

const ACTIVE_KEEP = new Set(['accepted', 'arriving', 'in_progress', 'payment_required', 'searching', 'offered'])

export function isAdminUser(user, profile) {
  const allow = String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
  if (user?.email && allow.includes(String(user.email).toLowerCase())) return true
  return isAdminIdentity({
    jwtEmail: user?.email || profile?.email,
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

  const kind = feeKindFor(action, feeKind)
  const precomputed = explicitAmountCents == null ? readPrecomputedFeeCents(trip, kind) : null
  const due = amountDueForAction({
    action,
    fareCents: trip.fare_cents,
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
  let payment = null
  if (due.amountCents > 0 && !override) {
    payment = await collectPayment({
      sb,
      stripe,
      deps,
      tripId: trip.id,
      riderId: trip.rider_id,
      amountCents: due.amountCents,
      methods,
      kind: chargeKind,
      idempotencyKey: `${trip.id}:${chargeKind}:${due.amountCents}`,
      hold: true,
      midRide: action !== 'complete' || ['accepted', 'arriving', 'in_progress'].includes(trip.status),
      paymentMethodId,
      metadata: { action, feeKind: chargeKind },
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
      idempotencyKey: `${trip.id}:${chargeKind}:${due.amountCents}:admin`,
      hold: true,
    })
  }

  const gate = progressionGate({
    amountDueCents: due.amountCents,
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

  if (sb && gate.allow) {
    await clearPaymentHold(sb, trip.id, { farePaidDelta: 0 })
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

  const now = new Date().toISOString()
  const patch = action === 'complete'
    ? { status: 'completed', completed_at: now }
    : { status: 'canceled', canceled_at: now }

  if (sb) {
    const { error } = await sb.from('trips').update(patch).eq('id', trip.id)
    if (error) return { http: 500, body: { error: error.message, payment, progressed: false } }
    await sb.from('trip_events').insert({
      trip_id: trip.id,
      kind: patch.status,
      payload: { source: 'trip_settle', reason: gate.reason, amount_cents: due.amountCents },
    })
  }

  let payout = null
  if (action === 'complete' && trip.driver_id) {
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
      payout: payout ? { ok: payout.ok, status: payout.payout?.status, lastError: payout.payout?.lastError || null, amountCents: payout.payout?.amountCents } : null,
      keptActive: ACTIVE_KEEP.has(trip.status) && !gate.allow,
    },
  }
}
