/**
 * GET  /api/driver?action=perks          perks summary for the signed-in driver
 * POST /api/driver?action=perks {op:'config', key, value}  admin config edit
 */
import { admin, cors, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { awardBonuses, loadDriverTrips, loadPerkConfig } from '../perks.js'
import { firstRideDaily } from '../../shared/perks/firstRide.js'
import { streakProgress } from '../../shared/perks/streaks.js'
import { claimReferral, referralSummary } from '../driverReferral.js'
import { setLeaderboardOptOut, weeklyLeaderboard } from '../leaderboard.js'
import { surgeBonusAwards, surgeSummary } from '../surge.js'
import { partyQueueSummary, setPartyQueueOptIn } from '../partyQueue.js'
import { driverSafetyScore } from '../safetyScore.js'
import { driverScorecard, setMapMarker } from '../scorecard.js'

export const PERK_CONFIG_KEYS = ['streaks', 'first_ride_daily', 'referral', 'leaderboard', 'priority_dispatch', 'game_day_surge', 'party_queue', 'safety_score', 'scorecard']

export async function buildPerks(sb, driverId, { now = new Date(), firstName = null } = {}) {
  const trips = await loadDriverTrips(sb, driverId)
  const [streakCfg, firstCfg] = await Promise.all([
    loadPerkConfig(sb, 'streaks', {}),
    loadPerkConfig(sb, 'first_ride_daily', {}),
  ])
  const streaks = streakProgress(trips, driverId, streakCfg, now)
  const firstRide = firstRideDaily(trips, driverId, firstCfg, now)
  await awardBonuses(sb, driverId, [...streaks.awards, ...firstRide.awards]).catch((err) => console.error('[perks] award', err.message))
  const ledger = await sb.from('driver_bonus_ledger').select('kind, amount_cents, status, created_at')
    .eq('driver_id', driverId).order('created_at', { ascending: false }).limit(20)
  const referral = await referralSummary(sb, driverId, firstName).catch((err) => ({ error: err.message }))
  const surgeTrips = await sb.from('trips').select('id, status, pickup_lat, pickup_lng, accepted_at, started_at, completed_at, metadata')
    .eq('driver_id', driverId).eq('status', 'completed').gte('completed_at', new Date(Number(now) - 14 * 86400_000).toISOString()).limit(300)
  if (!surgeTrips.error) await awardBonuses(sb, driverId, await surgeBonusAwards(sb, surgeTrips.data, now)).catch((err) => console.error('[perks] surge', err.message))
  const surge = await surgeSummary(sb, now).catch((err) => ({ error: err.message }))
  const partyQueue = await partyQueueSummary(sb, driverId, now).catch((err) => ({ error: err.message }))
  const safety = await driverSafetyScore(sb, driverId, now).catch((err) => ({ error: err.message }))
  const scorecard = await driverScorecard(sb, driverId, now).catch((err) => ({ error: err.message }))
  const leaderboard = await weeklyLeaderboard(sb, driverId, { now }).catch((err) => ({ error: err.message }))
  return {
    streaks: { trips: streaks.trips, days: streaks.days },
    firstRide: {
      enabled: firstRide.enabled,
      bonusCents: firstRide.bonusCents,
      earned: firstRide.earned,
      available: firstRide.available,
      today: firstRide.today,
    },
    referral,
    leaderboard,
    surge,
    partyQueue,
    safety,
    scorecard,
    bonuses: (ledger.data || []).map((r) => ({ kind: r.kind, amountCents: r.amount_cents, status: r.status, at: r.created_at })),
  }
}

export default async function handleDriverPerks(req, res, deps = {}) {
  if (cors(req, res)) return
  res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req, sb)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  try {
    if (req.method === 'GET') return json(res, 200, await buildPerks(sb, user.id, { now: deps.now, firstName: String(user.user_metadata?.full_name || '').split(/\s+/)[0] || null }))
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
    const { body, error } = parseBody(req)
    if (error) return json(res, 400, { error })
    if (body.op === 'claim-referral') {
      const claimed = await claimReferral(sb, user.id, body.code)
      return json(res, claimed.ok ? 200 : 409, claimed)
    }
    if (body.op === 'map-marker') {
      const r = await setMapMarker(sb, user.id, body.marker)
      return json(res, r.ok ? 200 : 409, r)
    }
    if (body.op === 'party-queue') return json(res, 200, await setPartyQueueOptIn(sb, user.id, body.optIn))
    if (body.op === 'leaderboard-opt-out') return json(res, 200, await setLeaderboardOptOut(sb, user.id, body.optOut))
    if (body.op !== 'config') return json(res, 400, { error: 'Unknown op' })
    const prof = await sb.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
    if (!prof.data?.is_admin) return json(res, 403, { error: 'Admin only' })
    if (!PERK_CONFIG_KEYS.includes(body.key) || !body.value || typeof body.value !== 'object') return json(res, 400, { error: 'Bad config' })
    const saved = await sb.from('driver_perk_config').upsert({ key: body.key, value: body.value, updated_at: new Date().toISOString(), updated_by: user.id })
    if (saved.error) return json(res, 500, { error: saved.error.message })
    return json(res, 200, { ok: true })
  } catch (err) {
    console.error('[perks]', err?.message)
    return json(res, 500, { error: 'perks_failed' })
  }
}
