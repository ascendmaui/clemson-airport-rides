/**
 * Rider-to-rider social promos (type rider_social).
 * Signup stores the code as pending. Credits are granted only after the
 * referred rider's first completed trip (DB trigger + payment-success hook).
 */
import { supabase } from './supabase'
import { normalizePromoCode } from './riderPromo'

const CLAIM_STATE_KEY = 'clemson_promo_claim_state'

export async function claimRiderSocialPromo(code) {
  if (!supabase) throw new Error('Supabase is not configured')
  const norm = normalizePromoCode(code)
  if (!norm) return { ok: true, claimed: false, reason: 'no_code' }
  const { data, error } = await supabase.rpc('claim_rider_social_promo', { p_code: norm })
  if (error) throw new Error(error.message)
  return data || { ok: false, error: 'Promo claim failed' }
}

/**
 * Apply the code captured at signup once a session exists.
 * Safe to call on later sign-in (email confirmation). Does not grant rewards.
 */
export async function maybeClaimStoredPromo(user, promoCode) {
  if (!supabase || !user?.id) return null
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData?.session) return null

  const code = normalizePromoCode(promoCode || user?.user_metadata?.promo_code)
  if (!code) return null

  let prev = ''
  try {
    prev = window.sessionStorage.getItem(CLAIM_STATE_KEY) || ''
  } catch {
    prev = ''
  }
  if (prev === `${user.id}:ok` || prev === `${user.id}:bad`) return null

  try {
    const res = await claimRiderSocialPromo(code)
    const bad = Boolean(res?.error)
    const done = res?.claimed || res?.reason === 'already_referred' || bad
    if (done) {
      try {
        window.sessionStorage.setItem(CLAIM_STATE_KEY, `${user.id}:${bad ? 'bad' : 'ok'}`)
      } catch {
        /* ignore */
      }
    }
    return res
  } catch (e) {
    console.warn('[promo claim]', e.message)
    return null
  }
}

export async function ensureRiderSocialCode() {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('ensure_rider_social_code')
  if (error) throw new Error(error.message)
  return data
}

/** Idempotent. No-op unless the trip is completed and it is the first ride. */
export async function grantRiderSocialForTrip(tripId) {
  if (!supabase || !tripId) return null
  const { data, error } = await supabase.rpc('grant_rider_social_for_trip', { p_trip_id: tripId })
  if (error) {
    console.warn('[rider_social]', error.message)
    return null
  }
  return data
}

export async function loadRiderReferralAccount(userId) {
  if (!supabase || !userId) return null
  let code = null
  try {
    code = await ensureRiderSocialCode()
  } catch (e) {
    console.warn('[rider_social code]', e.message)
  }

  const [cfgRes, refsRes, ledgerRes, profileRes, adminRes] = await Promise.all([
    supabase.from('rider_referral_config').select('*').eq('type', 'rider_social').maybeSingle(),
    supabase
      .from('rider_referrals')
      .select('id, status, code, referrer_id, referred_id, referrer_first_name, referred_first_name, referrer_reward_cents, referred_reward_cents, created_at, rewarded_at')
      .eq('type', 'rider_social')
      .or(`referrer_id.eq.${userId},referred_id.eq.${userId}`)
      .order('created_at', { ascending: false }),
    supabase
      .from('credit_ledger')
      .select('amount_cents, reason, source')
      .eq('profile_id', userId)
      .eq('source', 'social_promo')
      .like('reason', 'rider_social%'),
    supabase.from('profiles').select('referred_by, promo_code').eq('id', userId).maybeSingle(),
    supabase.rpc('is_admin'),
  ])

  const referrals = refsRes.data || []
  const creditCents = (ledgerRes.data || []).reduce((sum, row) => sum + (Number(row.amount_cents) || 0), 0)
  const isAdmin = adminRes.data === true
  let adminReport = []
  if (isAdmin) {
    const { data } = await supabase
      .from('rider_social_referral_report')
      .select('id, status, referrer_first_name, referred_first_name, referrer_reward_cents, referred_reward_cents, signed_up_at, rewarded_at')
      .order('signed_up_at', { ascending: false })
      .limit(20)
    adminReport = data || []
  }

  return {
    code: code || null,
    config: cfgRes.data || null,
    sent: referrals.filter((r) => r.referrer_id === userId),
    received: referrals.find((r) => r.referred_id === userId) || null,
    creditCents,
    promoCode: profileRes.data?.promo_code || null,
    isAdmin,
    adminReport,
    error: refsRes.error?.message || ledgerRes.error?.message || cfgRes.error?.message || null,
  }
}
