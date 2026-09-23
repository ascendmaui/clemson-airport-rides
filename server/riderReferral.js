/**
 * Server hook for rider_social rewards.
 * Payment success calls grant_rider_social_for_trip. The SQL function no-ops
 * unless that trip is already completed and it is the referred user's first ride.
 * The trips status trigger is the trip-complete hook. Both are idempotent.
 *
 * ANTI-DOUBLE-DIP: promo_codes / rider_referrals type rider_social.
 * Shared credit_ledger source is social_promo (reason rider_social_*).
 * claim_signup_reward(profile, 'social_promo', id) is one grant per new user.
 * If public.referrals already claimed source referral, this path pays nothing.
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
