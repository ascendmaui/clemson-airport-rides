/**
 * ONE REWARD GRANT PER NEW USER — shared by both credit systems.
 *
 * Systems
 * - referral: general rider + driver referral. Pays on the new user's first
 *   completed trip (as rider or as driver). Owned by this feature.
 * - social_promo: rider-to-rider social promo codes. Owned by a separate agent.
 *
 * Before either system writes a welcome credit for a new user, it must call
 * claimSignupReward (or the SQL function claim_signup_reward). The first claim
 * wins. If `claimed` is not true, that signup is already rewarded: do not pay
 * the new user and do not pay a referrer for that signup.
 *
 * Welcome credits go in public.credit_ledger (shared balance).
 * Do not write them to rider_credit_ledger or rider_credit_lots — those tables
 * are purchased prepaid ride packs.
 *
 * Ledger rows
 * - source 'referral', reasons referral_referrer / referral_referee
 * - source 'social_promo', reasons social_promo_referrer / social_promo_invitee
 *
 * Use a stable source_ref (the referral id or promo grant id) so a retry of the
 * same grant still owns the claim. Use a stable credit_ledger.idempotency_key
 * so a retry does not insert a second row.
 */
export const SIGNUP_REWARD_SOURCES = {
  referral: 'referral',
  socialPromo: 'social_promo',
}

export const SHARED_CREDIT_LEDGER = 'credit_ledger'

export const SIGNUP_REWARD_REASONS = {
  referralReferrer: 'referral_referrer',
  referralReferee: 'referral_referee',
  socialPromoReferrer: 'social_promo_referrer',
  socialPromoInvitee: 'social_promo_invitee',
}

export async function claimSignupReward(sb, profileId, source, sourceRef = null) {
  const { data, error } = await sb.rpc('claim_signup_reward', {
    p_profile_id: profileId,
    p_source: source,
    p_source_ref: sourceRef,
  })
  if (error) throw new Error(error.message)
  return data
}
