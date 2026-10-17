/**
 * Global payouts kill switch. Every path that moves money to a driver
 * (Stripe transfers and payouts) checks payoutsHeld() first.
 *
 * Source of truth: public.payout_controls (id = 1).payouts_enabled.
 * - PAYOUTS_HOLD=1 in the env forces a hold regardless of the row.
 * - Row unreadable or missing: held when the Stripe key is live (fail
 *   closed), not held in test mode so staging and tests behave as before.
 * Re-enable: docs/PAYOUTS_HOLD.md.
 */
import { isLiveStripeKey } from '../shared/payoutApproval.js'
import { PAYOUT_HOLD_ERROR } from '../shared/payoutHold.js'

export { PAYOUT_HOLD_ERROR }

function flagOn(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

export async function payoutsHeld({ sb = null, env = process.env } = {}) {
  if (flagOn(env?.PAYOUTS_HOLD)) return true
  const fallback = isLiveStripeKey(env?.STRIPE_SECRET_KEY)
  if (!sb || typeof sb.from !== 'function') return fallback
  try {
    const res = await sb.from('payout_controls').select('payouts_enabled').eq('id', 1).maybeSingle()
    const enabled = res?.data?.payouts_enabled
    if (!res?.error && typeof enabled === 'boolean') return !enabled
  } catch {
    // fall through
  }
  return fallback
}

/** The record a held payout keeps: still pending, no attempt counted. */
export function heldPayoutRecord(existing, amountCents) {
  return {
    ...(existing || {}),
    amountCents,
    status: 'pending',
    pending: true,
    lastError: PAYOUT_HOLD_ERROR,
    nextRetryAt: null,
  }
}
