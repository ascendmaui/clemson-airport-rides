/** Loads stats/config for matching boosts. Any failure means no boost. */
import { applyDispatchBoosts, priorityBoost } from '../shared/perks/dispatchBoost.js'
import { isDemoDriverId } from '../shared/demoFleet.js'
import { isSimulatedDriverId } from '../packages/rides-native/simulatedDrivers.js'
import { isBusyRosterId } from '../packages/rides-native/busyRoster.js'
import { surgeExtraBoost } from './surge.js'
import { partyExtraBoost } from './partyQueue.js'
import { driverSafetyScores } from './safetyScore.js'
import { safetyDispatchBoost } from '../shared/perks/safetyScore.js'

export const isFakeDriver = (id) => isDemoDriverId(id) || isSimulatedDriverId(id) || isBusyRosterId(id)

async function config(sb, key) {
  const res = await sb.from('driver_perk_config').select('value').eq('key', key).maybeSingle()
  if (res?.error || !res?.data?.value) return null
  return res.data.value
}

export async function loadPriorityStats(sb, ids) {
  const stats = {}
  const prof = await sb.from('profiles').select('id, rating_avg, rating_count').in('id', ids)
  if (prof?.error) return null
  for (const p of prof.data || []) stats[p.id] = { rating: p.rating_avg, ratingCount: p.rating_count, trips: 0 }
  const trips = await sb.from('trips').select('driver_id').in('driver_id', ids).eq('status', 'completed').limit(20000)
  if (trips?.error) return null
  for (const t of trips.data || []) if (stats[t.driver_id]) stats[t.driver_id].trips += 1
  return stats
}

/**
 * Reorder assignable drivers with configured boosts. extraBoost(driver) lets
 * other perks (game-day zones) add to the score. Returns the input unchanged
 * when config is missing/disabled or any read fails.
 */
export async function boostAssignableDrivers(sb, drivers, { extraBoost = null, pickup = null } = {}) {
  if (!sb || !Array.isArray(drivers) || drivers.length < 2) return drivers
  try {
    if (!extraBoost && pickup) {
      const parts = (await Promise.all([
        surgeExtraBoost(sb, pickup, drivers).catch(() => null),
        partyExtraBoost(sb, pickup).catch(() => null),
      ])).filter(Boolean)
      // Safety score only touches dispatch when an admin sets affectsDispatch.
      const safetyCfg = await config(sb, 'safety_score')
      if (safetyCfg?.affectsDispatch === true) {
        const scores = await driverSafetyScores(sb, drivers.slice(0, 10).map((d) => d.id), { config: safetyCfg })
          .catch(() => new Map())
        parts.push((d) => safetyDispatchBoost(scores.get(d.id), safetyCfg))
      }
      if (parts.length) extraBoost = (d) => parts.reduce((sum, fn) => sum + (Number(fn(d)) || 0), 0)
    }
    const cfg = await config(sb, 'priority_dispatch')
    const priorityOn = cfg && cfg.enabled !== false
    const stats = priorityOn ? await loadPriorityStats(sb, drivers.map((d) => d.id)) : null
    if (!stats && !extraBoost) return drivers
    return applyDispatchBoosts(drivers, (d) => (stats ? priorityBoost(d.id, stats[d.id], cfg, isFakeDriver) : 0) + (extraBoost ? Number(extraBoost(d)) || 0 : 0))
  } catch {
    return drivers
  }
}
