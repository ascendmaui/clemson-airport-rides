/**
 * Canonical platform fee split for Clemson RIDES.
 *
 * Ride-rate cards, wait-time fees, and mid-ride cancel fees are owned by
 * their own modules. This file only splits a gross fare into the 20% platform
 * fee and the driver net. If a trip already carries `metadata.platform_fee_cents`
 * or `metadata.driver_net_cents` (rates work), callers must prefer those values
 * via `resolvePlatformFeeCents` / `resolveDriverNetCents` in shared/paymentFailure.js.
 */

export const PLATFORM_FEE_RATE = 0.2
export const PLATFORM_FEE_BPS = 2000

export function platformFeeCents(grossCents) {
  const gross = Math.max(0, Math.round(Number(grossCents) || 0))
  return Math.round((gross * PLATFORM_FEE_BPS) / 10000)
}

export function driverNetCents(grossCents) {
  const gross = Math.max(0, Math.round(Number(grossCents) || 0))
  return Math.max(0, gross - platformFeeCents(gross))
}
