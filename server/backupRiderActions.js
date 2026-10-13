/**
 * Rider switch and cancel for a scheduled ride that has a backup driver.
 * The backup fee is captured once. A switch redirects it to the former
 * primary. A cancel partial-captures it and releases the rest of the hold.
 */
import { readDriverPushToken } from './driverPushToken.js'
import { unchangedOfferQuery } from '../shared/driverOrder.js'
import { insertTripEvent } from './tripEvents.js'
import { sendExpoPush } from './expoPush.js'
import { settleFareHold } from './fareAuthorization.js'
import { attemptCancelFeePayout } from './payouts.js'
import { publicDriverCard } from './backupDriverDispatch.js'
import {
  readBackupQueue,
  riderBackupPresentation,
  riderCancelCapture,
  swapBackupDrivers,
} from '../shared/backupDriverQueue.js'

async function loadTrip(sb, tripId) {
  const row = await sb.from('trips').select('*').eq('id', tripId).maybeSingle()
  if (row.error) throw new Error(row.error.message)
  return row.data
}

async function commitTrip(sb, trip, queue, patch = {}) {
  const metadata = { ...(trip.metadata || {}), backup_queue: queue }
  const updated = await unchangedOfferQuery(
    sb.from('trips').update({ metadata, ...patch }),
    trip,
  ).eq('id', trip.id).select('id, status, driver_id, metadata').maybeSingle()
  if (updated.error) throw new Error(updated.error.message)
  return updated.data || null
}

async function audit(sb, tripId, kind, payload) {
  try {
    await insertTripEvent(sb, { trip_id: tripId, kind, payload })
  } catch (error) {
    console.error('[backup-rider]', kind, error?.message || error)
  }
}

async function pushToDriver(sb, driverId, { title, body, tripId, kind }) {
  if (!driverId) return
  const { token } = await readDriverPushToken(sb, driverId)
  if (!token) return
  await sendExpoPush({
    to: token,
    title,
    body,
    data: { tripId, kind },
    channelId: 'ride-requests',
  })
}

function openStatuses(status) {
  return ['scheduled', 'accepted', 'arriving'].includes(status)
}

export async function switchBackupDriver(sb, { tripId, riderId, safetyReport = false, now = new Date() } = {}) {
  const trip = await loadTrip(sb, tripId)
  if (!trip) return { ok: false, status: 404, error: 'Scheduled ride not found' }
  if (trip.rider_id !== riderId) return { ok: false, status: 403, error: 'This ride is on another account' }
  if (!openStatuses(trip.status)) return { ok: false, status: 409, error: 'This ride can no longer be switched' }
  const queue = readBackupQueue(trip)
  if (!queue) return { ok: false, status: 409, error: 'This ride has no backup driver' }
  const at = now.toISOString()
  const swapped = swapBackupDrivers(trip, queue, { now: at, safetyReport })
  if (!swapped.ok) {
    const message = swapped.code === 'switch_limit'
      ? 'You can switch to the backup once.'
      : swapped.code === 'already_enroute'
        ? 'Your driver is already on the way. A safety report is required to switch.'
        : swapped.code === 'backup_not_filled'
          ? 'A backup driver has not accepted yet.'
          : 'This ride can no longer be switched'
    return { ok: false, status: 409, error: message, code: swapped.code }
  }
  const saved = await commitTrip(sb, trip, swapped.queue, { status: 'scheduled', driver_id: null })
  if (!saved) return { ok: false, status: 409, error: 'This ride changed. Refresh and try again.', raced: true }
  await audit(sb, trip.id, 'rider_switch', {
    at,
    formerPrimaryId: swapped.formerPrimaryId,
    newPrimaryId: swapped.newPrimaryId,
    feeCents: swapped.feeCents,
    feeLabel: 'Switch fee',
    safetyReport: Boolean(safetyReport),
  })
  const nextNotice = swapped.queue.driverNotices?.[swapped.newPrimaryId]
  const backupNotice = swapped.queue.driverNotices?.[swapped.formerPrimaryId]
  await pushToDriver(sb, swapped.newPrimaryId, {
    tripId: trip.id,
    kind: 'rider_switch_primary',
    title: nextNotice?.title || "You're the driver",
    body: nextNotice?.body || "You're now the driver for this trip.",
  })
  await pushToDriver(sb, swapped.formerPrimaryId, {
    tripId: trip.id,
    kind: 'rider_switch_backup',
    title: backupNotice?.title || "You're the backup",
    body: backupNotice?.body || "You're #2 for this trip. Pickup time is unchanged.",
  })
  return {
    ok: true,
    action: 'switch',
    tripId: trip.id,
    formerPrimaryId: swapped.formerPrimaryId,
    newPrimaryId: swapped.newPrimaryId,
    feeCents: swapped.feeCents,
    feeLabel: 'Switch fee',
    backup: riderBackupPresentation({ ...trip, status: 'scheduled', metadata: { ...trip.metadata, backup_queue: swapped.queue } }),
  }
}

export async function cancelBackupRide(sb, { tripId, riderId, now = new Date(), settle, stripe } = {}) {
  const trip = await loadTrip(sb, tripId)
  if (!trip) return { ok: false, status: 404, error: 'Scheduled ride not found' }
  if (trip.rider_id !== riderId) return { ok: false, status: 403, error: 'This ride is on another account' }
  const queue = readBackupQueue(trip)
  if (!queue) return { ok: true, useExistingCancel: true }
  if (trip.status === 'canceled' || queue.cancelSettledAt) {
    return { ok: true, action: 'cancel', idempotent: true, tripId: trip.id, feeCents: queue.cancelFeeCents || 0 }
  }
  if (!openStatuses(trip.status) && trip.status !== 'searching' && trip.status !== 'offered') {
    return { ok: false, status: 409, error: 'This ride can no longer be canceled' }
  }
  const plan = riderCancelCapture(trip)
  const at = now.toISOString()
  let capturedCents = 0
  if (plan.cents > 0) {
    const settleHold = settle || settleFareHold
    const settled = await settleHold({ sb, stripe, trip, finalFareCents: plan.cents })
    if (settled && settled.ok === false) {
      return { ok: false, status: 402, error: 'Could not capture the cancellation fee. The ride is still scheduled.', code: 'capture_failed' }
    }
    capturedCents = Math.max(0, Math.round(Number(settled?.amountCents) || 0))
  } else if (trip.metadata?.fare_authorization?.status === 'requires_capture') {
    const settleHold = settle || settleFareHold
    await settleHold({ sb, stripe, trip, finalFareCents: 0 })
  }
  const fresh = await loadTrip(sb, trip.id)
  const freshQueue = readBackupQueue(fresh) || queue
  const next = {
    ...freshQueue,
    cancelFeeDriverId: capturedCents > 0 ? plan.feeDriverId : null,
    cancelFeeCents: capturedCents,
    cancelSettledAt: at,
    backupStoodBy: false,
    events: [...(freshQueue.events || []), {
      kind: 'rider_cancel',
      at,
      feeCents: plan.cents,
      feeLabel: plan.feeLabel || 'Cancellation fee',
      feeDriverId: plan.feeDriverId,
      boostRefunded: plan.boostRefunded === true,
      boostCents: plan.boostCents || 0,
    }].slice(-12),
    generation: freshQueue.generation + 1,
  }
  const saved = await commitTrip(sb, fresh || trip, next, { status: 'canceled', canceled_at: at, driver_id: null })
  if (!saved) return { ok: false, status: 409, error: 'This ride changed. Refresh and try again.', raced: true }
  await audit(sb, trip.id, 'rider_cancel', {
    at,
    feeCents: plan.cents,
    feeLabel: plan.feeLabel || null,
    feeDriverId: plan.feeDriverId,
    boostRefunded: plan.boostRefunded === true,
    capturedCents,
  })
  if (plan.feeDriverId && capturedCents > 0) {
    const payable = { ...trip, status: 'canceled', metadata: { ...(trip.metadata || {}), backup_queue: next } }
    try {
      await attemptCancelFeePayout({ sb, trip: payable, stripe, now: now.getTime() })
    } catch (error) {
      console.error('[backup-rider] cancel payout', error?.message || error)
    }
    await pushToDriver(sb, plan.feeDriverId, {
      tripId: trip.id,
      kind: 'rider_cancel',
      title: 'Scheduled ride canceled',
      body: 'The rider canceled this pickup. You are released from the trip.',
    })
  }
  const otherId = plan.feeDriverId === queue.primaryDriverId ? queue.backupDriverId : queue.primaryDriverId
  if (otherId && otherId !== plan.feeDriverId) {
    await pushToDriver(sb, otherId, {
      tripId: trip.id,
      kind: 'rider_cancel',
      title: 'Scheduled ride canceled',
      body: 'The rider canceled this pickup. You are released from the trip.',
    })
  }
  return {
    ok: true,
    action: 'cancel',
    tripId: trip.id,
    feeCents: plan.cents,
    feeLabel: plan.feeLabel || null,
    feeDriverId: plan.feeDriverId,
    boostRefunded: plan.boostRefunded === true,
    capturedCents,
    backupPayoutCents: plan.backupPayoutCents,
  }
}

export async function backupRideDetail(sb, { tripId, riderId }) {
  const trip = await loadTrip(sb, tripId)
  if (!trip) return { ok: false, status: 404, error: 'Scheduled ride not found' }
  if (trip.rider_id !== riderId) return { ok: false, status: 403, error: 'This ride is on another account' }
  let queue = readBackupQueue(trip)
  if (!queue) return { ok: true, backup: null }
  let changed = false
  if (queue.primaryDriverId && !queue.primaryCard?.name) {
    queue = { ...queue, primaryCard: await publicDriverCard(sb, queue.primaryDriverId) }
    changed = true
  }
  if (queue.backupDriverId && !queue.backupCard?.name) {
    queue = { ...queue, backupCard: await publicDriverCard(sb, queue.backupDriverId) }
    changed = true
  }
  if (changed) await commitTrip(sb, trip, queue)
  return {
    ok: true,
    backup: riderBackupPresentation({ ...trip, metadata: { ...(trip.metadata || {}), backup_queue: queue } }),
  }
}
