/**
 * Pickup wait-time fee — shared by the active-ride UI and /api/trip-wait.
 *
 * Clock starts at server `arrived_at` (status `arrived` only).
 * Fee uses ceil of whole minutes after a 3-minute grace, at $1 (100¢) per minute.
 * The clock is capped at 7:00 so a late settle cannot bill a 5th wait minute.
 *
 * Examples (elapsed from arrived_at):
 * - 0:00–3:00 inclusive → $0 (grace)
 * - 3:00.001 → 1 billable minute → $1
 * - 5:00 → $2 wait. Optional cancel charges that $2. Platform keeps 20% ($0.40), driver 80% ($1.60).
 * - Completed trip: same 20/80 split on wait_fee_cents via splitPlatformCut. No cancel fee.
 * - 7:00 auto-cancel package only: rider pays $5 ($4 wait + $1 cancel).
 *   splitPlatformCut on that $5 is platform $1, driver $4 (driver keeps the full wait fee).
 *
 * Driver cancel from 5:00 until 7:00 is optional — they can keep waiting.
 * Waiting stops accruing once status leaves `arrived` (start trip or cancel).
 */

import { splitPlatformCut } from './platformFee.js'

export const GRACE_MS = 3 * 60 * 1000
export const CANCEL_AVAILABLE_MS = 5 * 60 * 1000
export const AUTO_CANCEL_MS = 7 * 60 * 1000
export const CENTS_PER_WAIT_MINUTE = 100
export const AUTO_CANCEL_FEE_CENTS = 100

export function elapsedMs(arrivedAt, now = Date.now()) {
  if (!arrivedAt) return 0
  const start = new Date(arrivedAt).getTime()
  if (!Number.isFinite(start)) return 0
  return Math.max(0, now - start)
}

/** Billable minutes after grace. Exact minute boundaries stay exact (7:00 → 4, not 5). */
export function billableMinutesFromElapsed(elapsed) {
  const capped = Math.min(Math.max(0, Number(elapsed) || 0), AUTO_CANCEL_MS)
  const afterGrace = capped - GRACE_MS
  if (afterGrace <= 0) return 0
  return Math.ceil(afterGrace / 60000)
}

export function waitFeeCentsFromElapsed(elapsed) {
  return billableMinutesFromElapsed(elapsed) * CENTS_PER_WAIT_MINUTE
}

export function waitFeeCents(arrivedAt, now = Date.now()) {
  return waitFeeCentsFromElapsed(elapsedMs(arrivedAt, now))
}

export function formatClock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatUsd(cents) {
  return (Number(cents) / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

export function quoteWait(arrivedAt, now = Date.now()) {
  const elapsed = elapsedMs(arrivedAt, now)
  const waitFee = arrivedAt ? waitFeeCentsFromElapsed(elapsed) : 0
  const displayMs = Math.min(elapsed, AUTO_CANCEL_MS)
  return {
    elapsedMs: elapsed,
    displayMs,
    waitFeeCents: waitFee,
    inGrace: Boolean(arrivedAt) && elapsed <= GRACE_MS,
    cancelAvailable: Boolean(arrivedAt) && elapsed >= CANCEL_AVAILABLE_MS && elapsed < AUTO_CANCEL_MS,
    autoDue: Boolean(arrivedAt) && elapsed >= AUTO_CANCEL_MS,
    clock: formatClock(displayMs),
  }
}

/**
 * @param {number} elapsed
 * @param {'auto'|'driver'|'complete'} reason
 */
export function settleWait(elapsed, reason) {
  const at = reason === 'auto' ? AUTO_CANCEL_MS : elapsed
  const waitFeeCents = waitFeeCentsFromElapsed(at)
  const cancelFeeCents = reason === 'auto' ? AUTO_CANCEL_FEE_CENTS : 0
  const cut = splitPlatformCut({ waitFeeCents, cancelFeeCents })
  return {
    reason,
    waitFeeCents,
    cancelFeeCents,
    platformFeeCents: cut.platformFeeCents,
    riderChargeCents: cut.grossCents,
    driverEarningsCents: cut.driverNetCents,
  }
}
