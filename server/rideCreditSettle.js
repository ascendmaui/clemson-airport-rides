/**
 * Debit prepaid ride credits when a credits-chosen trip completes.
 * The ledger key is the trip id, so a second settle does not debit again.
 */
import { supabaseCreditStore } from './credits.js'

export function rideCreditKey(tripId) {
  return `ride_credits:${tripId}`
}

export async function debitStoredRideCredits({
  sb,
  store = null,
  riderId,
  tripId,
  amountCents,
}) {
  const cents = Math.max(0, Math.round(Number(amountCents) || 0))
  if (cents <= 0 || !riderId || !tripId) {
    return { ok: true, debitedCents: 0, duplicate: false, balanceCents: 0 }
  }
  const credits = store || supabaseCreditStore(sb)
  const result = await credits.applyCredits(riderId, -cents, {
    kind: 'ride_redemption',
    tripId,
    idempotencyKey: rideCreditKey(tripId),
  })
  if (!result?.ok) {
    return {
      ok: false,
      code: result?.code || 'credits_unavailable',
      balanceCents: Math.max(0, Math.round(Number(result?.balanceCents) || 0)),
      debitedCents: 0,
    }
  }
  return {
    ok: true,
    duplicate: Boolean(result.duplicate),
    balanceCents: Math.max(0, Math.round(Number(result.balanceCents) || 0)),
    debitedCents: cents,
  }
}
