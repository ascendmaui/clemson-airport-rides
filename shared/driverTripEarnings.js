/**
 * One driver-net calculation for a trip, shared by the payout queue (server/payouts.js)
 * and every driver screen (live trip header, fare panel, trip-end summary).
 *
 * netCents = fare net (Tiger Heat settled pay, else the accept-locked
 *            metadata.driver_net_cents / driver_payout_cents, else 80%)
 *          + driver share of any boost not already in that net
 *          + backup-queue bonus (when promoted from backup)
 *          + driver wait share (completed trips only).
 * Wait cancellations pay only the wait share; other cancellations pay nothing.
 * Tips are not in this number: they are charged after the trip and shown separately.
 */
import { resolveDriverNetCents } from './paymentFailure.js'
import { readBackupQueue, readScheduledBoostCents } from './backupDriverQueue.js'
import { driverBoostShareCents, readBoostCents } from './scheduledBoost.js'

const cents = (value) => Math.max(0, Math.round(Number(value) || 0))

/** Settled Tiger Heat pay replaces the default 80% net. Rider fare is not in this number. */
export function tigerHeatPayoutCents(trip) {
  const heat = trip?.metadata?.tiger_heat
  if (!heat || heat.preview || heat.settled !== true || heat.released) return null
  const amount = Number(heat.driverEarningsCents)
  if (!Number.isFinite(amount)) return null
  return Math.max(0, Math.round(amount))
}

export function driverTripEarnings(trip) {
  const status = String(trip?.status || '')
  const fareCents = cents(trip?.fare_cents)
  const waitShare = cents(trip?.driver_wait_earnings_cents)
  const riderWaitFeeCents = cents(trip?.wait_fee_cents)
  const tipCents = cents(trip?.tip_cents)
  if (status === 'cancelled_wait' || status === 'canceled' || status === 'canceled_midride') {
    const waitCents = status === 'cancelled_wait' ? waitShare : 0
    return {
      kind: 'cancel', fareCents, fareNetCents: 0, platformFeeCents: 0, boostCents: 0, backupBonusCents: 0,
      waitCents, riderWaitFeeCents, tigerHeatBonusCents: 0, platformFundedCents: 0, tipCents, netCents: waitCents,
    }
  }
  const heatPay = tigerHeatPayoutCents(trip)
  const fareNetCents = heatPay == null ? resolveDriverNetCents(trip) : heatPay
  const included = trip?.metadata?.boost_included_in_driver_net === true
  const boostSource = included ? 0 : Math.max(readBoostCents(trip), readScheduledBoostCents(trip?.metadata))
  const boostCents = driverBoostShareCents(boostSource)
  const queue = readBackupQueue(trip)
  const backupBonusCents = heatPay == null && queue?.promotedFromBackup && queue.confirmState !== 'released'
    ? cents(queue.bonusCents)
    : 0
  const waitCents = status === 'completed' ? waitShare : 0
  const heat = trip?.metadata?.tiger_heat
  return {
    kind: 'trip',
    fareCents,
    fareNetCents,
    platformFeeCents: heatPay == null ? Math.max(0, fareCents - fareNetCents) : 0,
    boostCents,
    backupBonusCents,
    waitCents,
    riderWaitFeeCents,
    tigerHeatBonusCents: heatPay == null ? 0 : cents(heat?.bonusCents),
    platformFundedCents: heatPay == null ? 0 : cents(heat?.platformFundedCents),
    tipCents,
    netCents: fareNetCents + boostCents + backupBonusCents + waitCents,
  }
}

/** The stored payout record wins once it exists (it is what Stripe is sent). */
export function driverTripNetCents(trip) {
  const stored = trip?.metadata?.payout
  if (stored && stored.amountCents != null && Number.isFinite(Number(stored.amountCents))) return cents(stored.amountCents)
  return driverTripEarnings(trip).netCents
}

const PAYOUT_LINES = {
  paid: 'Paid out to your bank account.',
  succeeded: 'Paid out to your bank account.',
  pending: 'Payout is on the way.',
  processing: 'Payout is on the way.',
  failed: 'Payout did not go through yet. It retries automatically.',
}

/** Plain-English payout status for the trip-end summary. */
export function payoutStatusLine(trip) {
  const status = String(trip?.metadata?.payout?.status || '')
  return PAYOUT_LINES[status] || 'Payout is on the way.'
}
