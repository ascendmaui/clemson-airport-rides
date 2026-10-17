/**
 * Driver payout queue. Amounts use metadata.driver_net_cents when the rates
 * work has already split the fare; otherwise the shared 20% helper.
 * Failures stay pending and retry on backoff. They are surfaced in earnings.
 */
import { stripeClient } from './friendRideLib.js'
import { applyPayoutAttempt, payoutIsDue } from '../shared/paymentFailure.js'
import {
  CANCEL_FEE_LABEL,
  SWITCH_FEE_LABEL,
  payoutPlanForTrip,
  readBackupQueue,
  switchFeePayoutForTrip,
} from '../shared/backupDriverQueue.js'
import { driverTripEarnings, tigerHeatPayoutCents } from '../shared/driverTripEarnings.js'
import { payoutApprovalRequired } from '../shared/payoutApproval.js'
import {
  approvalIdempotencyKey, isDefiniteStripeError, markApprovalFailed, markApprovalSent, payoutGate, usableConnectAccount,
} from './payoutApproval.js'
import { PAYOUT_HOLD_ERROR, heldPayoutRecord, payoutsHeld } from './payoutHold.js'

export { tigerHeatPayoutCents }

/** Wait cancellations never include the booked fare, boosts, or carpool bonuses. */
export function buildWaitCancelPayoutRecord(trip) {
  const amountCents = Math.max(0, Math.round(Number(trip.driver_wait_earnings_cents) || 0))
  return {
    tripId: trip.id, driverId: trip.driver_id, kind: 'wait_cancel',
    amountCents, fareNetCents: 0, boostCents: 0, waitCents: amountCents,
    status: amountCents === 0 ? 'paid' : 'pending', pending: amountCents !== 0,
    attempts: 0, lastError: null, nextRetryAt: null, stripeTransferId: null,
  }
}

export function buildPayoutRecord(trip) {
  if (trip.status === 'cancelled_wait') return buildWaitCancelPayoutRecord(trip)
  if (['canceled', 'canceled_midride'].includes(trip.status)) {
    return buildWaitCancelPayoutRecord({ ...trip, driver_wait_earnings_cents: 0 })
  }
  // Same calculation every driver screen shows (shared/driverTripEarnings.js).
  const earned = driverTripEarnings(trip)
  const amountCents = earned.netCents
  return {
    tripId: trip.id,
    driverId: trip.driver_id,
    amountCents,
    fareNetCents: earned.fareNetCents,
    boostCents: earned.boostCents,
    prepaidTipCents: earned.prepaidTipCents,
    waitCents: earned.waitCents,
    tigerHeatBonusCents: earned.tigerHeatBonusCents,
    platformFundedCents: earned.platformFundedCents,
    status: amountCents === 0 ? 'paid' : 'pending',
    pending: amountCents !== 0,
    attempts: 0,
    lastError: null,
    nextRetryAt: null,
    stripeTransferId: null,
  }
}

const PREFIX_KINDS = {
  payout: 'trip_payout',
  'payout-backup': 'standby',
  'payout-cancel': 'cancel_fee',
  'payout-switch': 'switch_fee',
  'payout-tip': 'tip',
}

/** Stable approval source for one payout (never includes the attempt number). */
export function payoutSourceRef(trip, idempotencyPrefix = 'payout') {
  if (idempotencyPrefix === 'payout' && trip?.status === 'cancelled_wait') return `payout-wait:${trip.id}`
  return `${idempotencyPrefix}:${trip?.id}`
}

export function payoutKind(trip, idempotencyPrefix = 'payout') {
  if (idempotencyPrefix === 'payout' && trip?.status === 'cancelled_wait') return 'wait_cancel'
  return PREFIX_KINDS[idempotencyPrefix] || 'trip_payout'
}

function destinationMissing(err) {
  return /no such destination|no such account|test mode|live mode/i.test(String(err?.message || ''))
}

export async function attemptDriverPayout({
  trip, stripe, connectAccountId, now = Date.now(), idempotencyPrefix = 'payout', sb = null, env = process.env,
}) {
  const stored = trip?.metadata?.payout || buildPayoutRecord(trip)
  const existing = trip.status === 'cancelled_wait'
    ? { ...stored, ...buildWaitCancelPayoutRecord(trip), status: stored.status,
      pending: stored.pending, attempts: stored.attempts, lastError: stored.lastError,
      nextRetryAt: stored.nextRetryAt, stripeTransferId: stored.stripeTransferId }
    : stored
  const amountCents = existing.amountCents ?? buildPayoutRecord(trip).amountCents
  if (!amountCents) {
    const paid = applyPayoutAttempt(existing, { ok: true, now, amountCents: 0, transferId: null })
    return { ok: true, payout: { ...paid, amountCents: 0 }, zero: true }
  }
  if (existing.status === 'paid') return { ok: true, payout: existing, idempotent: true }
  if (!payoutIsDue(existing.status === 'pending' || existing.status === 'failed' ? existing : { ...existing, status: 'pending' }, now) && existing.attempts > 0) {
    return { ok: false, payout: existing, skipped: true, reason: 'not_due' }
  }
  // Payouts hold (docs/PAYOUTS_HOLD.md): stay pending, no attempt counted, no Stripe call.
  if (await payoutsHeld({ sb, env })) {
    return { ok: false, held: true, skipped: true, reason: PAYOUT_HOLD_ERROR, payout: heldPayoutRecord(existing, amountCents) }
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
  // Live money: admin approval first, and the destination must be a live account.
  let approval = null
  if (payoutApprovalRequired(env)) {
    const usable = await usableConnectAccount(stripe, connectAccountId, env)
    if (usable.needsReonboard) {
      return {
        ok: false,
        needsReonboard: true,
        payout: { ...existing, status: existing.status === 'pending_approval' ? 'pending' : existing.status, pending: true, lastError: 'needs_reonboard', nextRetryAt: null },
      }
    }
    const gate = await payoutGate({
      sb,
      env,
      kind: payoutKind(trip, idempotencyPrefix),
      sourceRef: payoutSourceRef(trip, idempotencyPrefix),
      payeeId: trip.driver_id,
      amountCents,
      sourceId: trip.id,
      tripId: trip.id,
      destination: connectAccountId,
      details: { idempotencyPrefix },
    })
    if (gate.alreadySent) {
      const paid = applyPayoutAttempt(existing, { ok: true, now, amountCents, transferId: gate.request?.stripe_transfer_id || null })
      return { ok: true, payout: { ...paid, approvalRequestId: gate.request?.id || null, approvalStatus: 'sent' }, idempotent: true }
    }
    if (!gate.allowed) {
      const requestId = gate.request?.id || null
      if (gate.status === 'pending_approval') {
        return {
          ok: false,
          pendingApproval: true,
          payout: { ...existing, status: 'pending_approval', pending: true, lastError: null, nextRetryAt: null, approvalRequestId: requestId, approvalStatus: 'pending_approval' },
        }
      }
      if (gate.status === 'rejected') {
        // Released back to the driver's unpaid balance (cash-out can request it again).
        return {
          ok: false,
          rejected: true,
          payout: { ...existing, status: 'pending', pending: true, lastError: 'rejected_by_admin', nextRetryAt: null, approvalRequestId: requestId, approvalStatus: 'rejected' },
        }
      }
      return {
        ok: false,
        skipped: true,
        reason: gate.status,
        payout: { ...existing, status: existing.status === 'pending_approval' ? 'pending' : existing.status, lastError: gate.status || 'approval_unavailable', approvalRequestId: requestId },
      }
    }
    approval = gate.request || null
  }
  try {
    if (!stripe?.transfers?.create) throw new Error('Stripe transfers unavailable')
    // One wait transfer even if concurrent ticks or a lost response replay it.
    // An approved request uses its own key, so one approval can only ever pay once.
    const idempotencyKey = approval
      ? approvalIdempotencyKey(approval)
      : (trip.status === 'cancelled_wait' ? `payout-wait:${trip.id}` : `${idempotencyPrefix}:${trip.id}:${existing.attempts || 0}`)
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: 'usd',
      destination: connectAccountId,
      transfer_group: trip.id,
      metadata: { tripId: trip.id, driverId: trip.driver_id || '', ...(approval ? { approvalRequestId: approval.id } : {}) },
    }, { idempotencyKey })
    const payout = applyPayoutAttempt(existing, {
      ok: true,
      now,
      amountCents,
      transferId: transfer.id,
    })
    if (approval) await markApprovalSent(sb, approval, { transferId: transfer.id })
    return { ok: true, payout: approval ? { ...payout, approvalRequestId: approval.id, approvalStatus: 'sent' } : payout }
  } catch (err) {
    const needsReonboard = Boolean(approval) && destinationMissing(err)
    const payout = applyPayoutAttempt(existing, {
      ok: false,
      error: needsReonboard ? 'needs_reonboard' : (err?.message || 'payout_failed'),
      now,
      amountCents,
    })
    if (approval) await markApprovalFailed(sb, approval, err, { definite: isDefiniteStripeError(err) })
    console.error('[payout]', { tripId: trip.id, attempt: payout.attempts, error: payout.lastError })
    return { ok: false, payout, needsReonboard: needsReonboard || undefined }
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
  const result = await attemptDriverPayout({ trip: nextTrip, stripe, connectAccountId, now, sb })
  await writePayout(sb, trip, result.payout)
  return result
}

/** Called only after the rider's wait charge succeeds. Re-read durable payout state. */
export async function enqueueWaitCancelPayout({ sb, trip, stripe, connectAccountId, now }) {
  if (trip?.status !== 'cancelled_wait') return { ok: true, skipped: true }
  const fresh = await sb.from('trips').select('metadata').eq('id', trip.id).maybeSingle()
  if (fresh.error) throw new Error(fresh.error.message)
  const queued = await sb.from('driver_payouts').select('*').eq('trip_id', trip.id).maybeSingle()
  if (queued.error) throw new Error(queued.error.message)
  const metadata = { ...(fresh.data?.metadata || trip.metadata || {}) }
  if (queued.data) {
    const row = queued.data
    metadata.payout = {
      ...buildWaitCancelPayoutRecord(trip), status: row.status, pending: row.status !== 'paid',
      attempts: row.attempts || 0, lastError: row.last_error, nextRetryAt: row.next_retry_at,
      stripeTransferId: row.stripe_transfer_id,
    }
  }
  const account = connectAccountId || await loadConnectAccount(sb, trip.driver_id)
  return enqueueAndAttemptPayout({ sb, trip: { ...trip, metadata },
    stripe: stripe === undefined ? stripeClient() : stripe, connectAccountId: account, now })
}

/** Standby backup bonus. Separate transfer so the completing driver's payout row stays put. */
export async function attemptStandbyBackupPayout({ sb, trip, stripe, connectAccountId, now = Date.now(), dryRun = false, env = process.env }) {
  const plan = payoutPlanForTrip(trip, 0)
  if (!plan?.standbyDriverId || plan.standbyCents <= 0) return null
  const existing = trip?.metadata?.backup_standby_payout
  if (existing?.status === 'paid') return { ok: true, payout: existing, idempotent: true }
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      payout: {
        tripId: trip.id,
        driverId: plan.standbyDriverId,
        amountCents: plan.standbyCents,
        status: existing?.status || 'pending',
        role: 'standby',
      },
    }
  }
  const record = existing || {
    tripId: trip.id,
    driverId: plan.standbyDriverId,
    amountCents: plan.standbyCents,
    status: 'pending',
    attempts: 0,
    role: 'standby',
  }
  const account = connectAccountId || await loadConnectAccount(sb, plan.standbyDriverId)
  const synthetic = {
    id: trip.id,
    driver_id: plan.standbyDriverId,
    fare_cents: plan.standbyCents,
    metadata: { driver_net_cents: plan.standbyCents, payout: record },
  }
  const result = await attemptDriverPayout({
    trip: synthetic,
    stripe,
    connectAccountId: account,
    now,
    idempotencyPrefix: 'payout-backup',
    sb,
    env,
  })
  await writeStandbyPayout(sb, trip, { ...result.payout, driverId: plan.standbyDriverId, role: 'standby' })
  return result
}

async function writeStandbyPayout(sb, trip, payout) {
  if (!sb || !trip?.id) return
  let metadata = { ...(trip.metadata || {}) }
  const fresh = await sb.from('trips').select('metadata').eq('id', trip.id).maybeSingle()
  if (!fresh.error && fresh.data?.metadata && typeof fresh.data.metadata === 'object') {
    metadata = { ...fresh.data.metadata }
  }
  metadata = { ...metadata, backup_standby_payout: { ...payout, tripId: trip.id } }
  await sb.from('trips').update({ metadata }).eq('id', trip.id)
  try {
    const saved = await sb.from('backup_driver_payouts').upsert({
      trip_id: trip.id,
      driver_id: payout.driverId,
      amount_cents: payout.amountCents,
      status: payout.status,
      role: 'standby',
      attempts: payout.attempts || 0,
      last_error: payout.lastError || null,
      stripe_transfer_id: payout.stripeTransferId || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'trip_id,role' })
    if (saved?.error && !/relation|does not exist|schema cache/i.test(saved.error.message || '')) {
      console.error('[payout] backup queue', saved.error.message)
    }
  } catch (error) {
    const message = error?.message || String(error)
    if (!/relation|does not exist|schema cache/i.test(message)) console.error('[payout] backup queue', message)
  }
}

/** Rider-cancel fee. One transfer, even if a switch had already assigned that same fee. */
export async function attemptCancelFeePayout({ sb, trip, stripe, connectAccountId, now = Date.now(), dryRun = false, env = process.env }) {
  const queue = readBackupQueue(trip)
  if (!queue?.cancelFeeDriverId || !queue.cancelFeeCents) return null
  return attemptRolePayout({
    sb,
    trip,
    stripe,
    connectAccountId,
    now,
    dryRun,
    plan: {
      driverId: queue.cancelFeeDriverId,
      cents: queue.cancelFeeCents,
      label: queue.switchFeeDriverId ? SWITCH_FEE_LABEL : CANCEL_FEE_LABEL,
      role: 'cancel_fee',
    },
    metadataKey: 'backup_cancel_payout',
    idempotencyPrefix: 'payout-cancel',
    env,
  })
}

/** One-time switch fee for the former primary. Separate from the fare payout. */
export async function attemptSwitchFeePayout({ sb, trip, stripe, connectAccountId, now = Date.now(), dryRun = false, env = process.env }) {
  const plan = switchFeePayoutForTrip(trip)
  if (!plan) return null
  return attemptRolePayout({
    sb,
    trip,
    stripe,
    connectAccountId,
    now,
    dryRun,
    plan,
    metadataKey: 'backup_switch_payout',
    idempotencyPrefix: 'payout-switch',
    env,
  })
}

/**
 * Post-trip tip (trips.tip_cents). 100% to the driver, its own transfer and ledger row
 * (backup_driver_payouts role 'tip'), separate from the fare payout so a tip that lands
 * after the fare was paid still goes out. Idempotent: a paid tip_payout is never re-sent,
 * and the Stripe idempotency key is payout-tip:<trip>:<attempt>.
 * Only completed trips; a tip marked refunded (metadata.tip_refunded) is not paid.
 */
export function tipPayoutPlan(trip) {
  if (!trip?.id || trip.status !== 'completed' || !trip.driver_id) return null
  if (trip.metadata?.e2e_test === true) return null
  if (trip.metadata?.tip_refunded === true) return null
  const cents = Math.max(0, Math.round(Number(trip.tip_cents ?? trip.metadata?.tip_cents) || 0))
  if (!cents) return null
  return { driverId: trip.driver_id, cents, label: 'Tip', role: 'tip' }
}

export async function attemptTipPayout({ sb, trip, stripe, connectAccountId, now = Date.now(), dryRun = false, env = process.env }) {
  const plan = tipPayoutPlan(trip)
  if (!plan) return null
  const existing = trip?.metadata?.tip_payout
  if (existing?.status === 'paid') {
    if (Number(existing.amountCents) !== plan.cents) {
      console.error('[payout] tip changed after payout', { tripId: trip.id, paid: existing.amountCents, now: plan.cents })
    }
    return { ok: true, payout: existing, idempotent: true }
  }
  return attemptRolePayout({
    sb, trip, stripe, connectAccountId, now, dryRun, plan,
    metadataKey: 'tip_payout',
    idempotencyPrefix: 'payout-tip',
    env,
  })
}

async function attemptRolePayout({
  sb, trip, stripe, connectAccountId, now, dryRun, plan, metadataKey, idempotencyPrefix, env = process.env,
}) {
  const existing = trip?.metadata?.[metadataKey]
  if (existing?.status === 'paid') return { ok: true, payout: existing, idempotent: true }
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      payout: {
        tripId: trip.id,
        driverId: plan.driverId,
        amountCents: plan.cents,
        status: existing?.status || 'pending',
        role: plan.role,
        label: plan.label,
      },
    }
  }
  const record = existing || {
    tripId: trip.id,
    driverId: plan.driverId,
    amountCents: plan.cents,
    status: 'pending',
    attempts: 0,
    role: plan.role,
    label: plan.label,
  }
  const account = connectAccountId || await loadConnectAccount(sb, plan.driverId)
  const synthetic = {
    id: trip.id,
    driver_id: plan.driverId,
    fare_cents: plan.cents,
    metadata: { driver_net_cents: plan.cents, payout: record },
  }
  const result = await attemptDriverPayout({
    trip: synthetic,
    stripe,
    connectAccountId: account,
    now,
    idempotencyPrefix,
    sb,
    env,
  })
  await writeRolePayout(sb, trip, { ...result.payout, driverId: plan.driverId, role: plan.role, label: plan.label }, metadataKey)
  return result
}

async function writeRolePayout(sb, trip, payout, metadataKey) {
  if (!sb || !trip?.id) return
  let metadata = { ...(trip.metadata || {}) }
  const fresh = await sb.from('trips').select('metadata').eq('id', trip.id).maybeSingle()
  if (!fresh.error && fresh.data?.metadata && typeof fresh.data.metadata === 'object') {
    metadata = { ...fresh.data.metadata }
  }
  metadata = { ...metadata, [metadataKey]: { ...payout, tripId: trip.id } }
  await sb.from('trips').update({ metadata }).eq('id', trip.id)
  try {
    const saved = await sb.from('backup_driver_payouts').upsert({
      trip_id: trip.id,
      driver_id: payout.driverId,
      amount_cents: payout.amountCents,
      status: payout.status,
      role: payout.role,
      attempts: payout.attempts || 0,
      last_error: payout.lastError || null,
      stripe_transfer_id: payout.stripeTransferId || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'trip_id,role' })
    if (saved?.error && !/relation|does not exist|schema cache/i.test(saved.error.message || '')) {
      console.error('[payout] backup queue', saved.error.message)
    }
  } catch (error) {
    const message = error?.message || String(error)
    if (!/relation|does not exist|schema cache/i.test(message)) console.error('[payout] backup queue', message)
  }
}

export async function loadConnectAccount(sb, driverId) {
  if (!sb || !driverId) return null
  const rich = await sb.from('profiles').select('stripe_account_id, stripe_connect_id').eq('id', driverId).maybeSingle()
  if (!rich.error && rich.data) {
    return rich.data.stripe_account_id || rich.data.stripe_connect_id || null
  }
  return null
}
