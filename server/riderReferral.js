/**
 * Server hook for rider_social rewards.
 * Payment success calls grant_rider_social_for_trip. The SQL function no-ops
 * unless that trip is already completed and it is the referred user's first ride.
 * The trips status trigger is the trip-complete hook. Both are idempotent.
 *
 * ANTI-DOUBLE-DIP with the general referral job only (source referral).
 * Ledger source is rider_social, not social_promo.
 * Does not call claim_signup_reward and does not write ambassador grants.
 * Campus ambassador code_type and game-week first-ride-free stay separate.
 */

export async function grantRiderSocialForTrip(sb, tripId) {
  if (!sb || !tripId) return { ok: true, granted: false, reason: 'no_trip' }
  const { data, error } = await sb.rpc('grant_rider_social_for_trip', { p_trip_id: tripId })
  if (error) {
    console.warn('[rider_social]', error.message)
    return { ok: false, error: error.message }
  }
  return data || { ok: true, granted: false }
}
