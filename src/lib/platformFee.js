/**
 * Shared platform cut.
 * The platform keeps 20% of fares, tips, wait fees, and cancel fees.
 * The driver keeps the other 80% (gross minus the fee, rounded once per total).
 */

export const PLATFORM_FEE_RATE = 0.2

export function platformFeeCents(amountCents) {
  return Math.round(Math.max(0, Number(amountCents) || 0) * PLATFORM_FEE_RATE)
}

/**
 * @param {{ fareCents?: number, tipCents?: number, waitFeeCents?: number, cancelFeeCents?: number }} parts
 */
export function splitPlatformCut({
  fareCents = 0,
  tipCents = 0,
  waitFeeCents = 0,
  cancelFeeCents = 0,
} = {}) {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  const tip = Math.max(0, Math.round(Number(tipCents) || 0))
  const wait = Math.max(0, Math.round(Number(waitFeeCents) || 0))
  const cancel = Math.max(0, Math.round(Number(cancelFeeCents) || 0))
  const grossCents = fare + tip + wait + cancel
  const fee = platformFeeCents(grossCents)
  return {
    fareCents: fare,
    tipCents: tip,
    waitFeeCents: wait,
    cancelFeeCents: cancel,
    grossCents,
    platformFeeCents: fee,
    driverNetCents: grossCents - fee,
    platformFeeRate: PLATFORM_FEE_RATE,
  }
}
