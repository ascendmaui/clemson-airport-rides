/**
 * Payouts hold: pure helpers shared by the server and the driver apps.
 * While held, earnings keep accruing as "pending payout"; nothing is lost.
 * See server/payoutHold.js and docs/PAYOUTS_HOLD.md.
 */

/** Error code stored on a held payout row (never shown to drivers raw). */
export const PAYOUT_HOLD_ERROR = 'payouts_on_hold'

export const PAYOUT_HOLD_COPY = 'Payouts are paused for now. Your earnings are safe and show as pending payout.'

export function isPayoutHoldError(code) {
  return String(code || '') === PAYOUT_HOLD_ERROR
}

/** Driver-facing last error: a hold is not an error, so it is hidden. */
export function driverPayoutError(code) {
  if (!code || isPayoutHoldError(code)) return null
  return code
}
