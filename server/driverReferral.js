/** Driver referral codes, claims and qualification (ledger kind referral). */
import { awardBonuses, loadPerkConfig } from './perks.js'
import { claimDecision, makeReferralCode, normalizeCode, referralAwards, referralProgress, shareLink } from '../shared/perks/referral.js'

export async function ensureReferralCode(sb, driverId, firstName) {
  const found = await sb.from('driver_referral_codes').select('code').eq('driver_id', driverId).maybeSingle()
  if (found.data?.code) return found.data.code
  for (let i = 0; i < 5; i += 1) {
    const code = makeReferralCode(firstName)
    const ins = await sb.from('driver_referral_codes').insert({ driver_id: driverId, code }).select('code').maybeSingle()
    if (!ins.error) return ins.data?.code || code
    const again = await sb.from('driver_referral_codes').select('code').eq('driver_id', driverId).maybeSingle()
    if (again.data?.code) return again.data.code
  }
  throw new Error('Could not create a referral code')
}

async function completedCounts(sb, ids) {
  const out = {}
  for (const id of ids) {
    const r = await sb.from('trips').select('id', { count: 'exact', head: true }).eq('driver_id', id).eq('status', 'completed')
    out[id] = r.count || 0
  }
  return out
}

export async function claimReferral(sb, refereeId, rawCode) {
  const code = normalizeCode(rawCode)
  const owner = await sb.from('driver_referral_codes').select('driver_id').eq('code', code).maybeSingle()
  const existing = await sb.from('driver_referrals').select('id').eq('referee_id', refereeId).maybeSingle()
  const counts = await completedCounts(sb, [refereeId])
  const decision = claimDecision({ referee: refereeId, referrerId: owner.data?.driver_id, existingClaim: existing.data, refereeCompletedTrips: counts[refereeId] })
  if (!decision.ok) return decision
  const ins = await sb.from('driver_referrals').insert({ referrer_id: owner.data.driver_id, referee_id: refereeId, code })
  if (ins.error) return { ok: false, error: /duplicate|unique/i.test(ins.error.message) ? 'already_claimed' : ins.error.message }
  return { ok: true }
}

/** Referrer view; also awards any newly qualified referrals. */
export async function referralSummary(sb, driverId, firstName) {
  const config = await loadPerkConfig(sb, 'referral', {})
  const code = await ensureReferralCode(sb, driverId, firstName)
  const list = await sb.from('driver_referrals').select('id, referrer_id, referee_id, status').eq('referrer_id', driverId)
  const referrals = list.data || []
  const counts = await completedCounts(sb, referrals.filter((r) => r.status === 'pending').map((r) => r.referee_id))
  const awards = referralAwards(referrals.filter((r) => r.status === 'pending'), counts, config)
  if (awards.length) {
    await awardBonuses(sb, driverId, awards)
    for (const a of awards) {
      await sb.from('driver_referrals').update({ status: 'qualified', qualified_at: new Date().toISOString() }).eq('id', a.referralId).eq('status', 'pending')
    }
  }
  return {
    code,
    link: shareLink(config, code),
    targetTrips: config.targetTrips ?? 10,
    bonusCents: config.bonusCents ?? 5000,
    enabled: config.enabled !== false,
    referrals: referralProgress(referrals.map((r) => (awards.some((a) => a.referralId === r.id) ? { ...r, status: 'qualified' } : r)), counts, config),
  }
}
