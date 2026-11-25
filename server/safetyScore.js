import { loadPerkConfig } from './perks.js'
import { gpsSignals, normalizeSafetyConfig, safetyScore } from '../shared/perks/safetyScore.js'

export async function driverSafetyScore(sb, driverId, now = new Date()) {
  const config = normalizeSafetyConfig(await loadPerkConfig(sb, 'safety_score', {}))
  if (!config.enabled) return { enabled: false }
  return scoreWithConfig(sb, driverId, config, now)
}

/**
 * Safety scores for several drivers at once (dispatch ranking).
 * Loads the config once (or takes the one the caller already has) and runs
 * the per-driver reads concurrently instead of one driver after another.
 * Per-driver queries are kept (not merged into one IN() read) so each driver
 * keeps their own row limit. A failed driver maps to null.
 * @returns {Promise<Map<string, object|null>>}
 */
export async function driverSafetyScores(sb, driverIds, { now = new Date(), config: rawConfig = null } = {}) {
  const ids = [...new Set((driverIds || []).filter(Boolean))]
  const out = new Map()
  if (!ids.length) return out
  const config = normalizeSafetyConfig(rawConfig || await loadPerkConfig(sb, 'safety_score', {}))
  if (!config.enabled) {
    for (const id of ids) out.set(id, { enabled: false })
    return out
  }
  const settled = await Promise.allSettled(ids.map((id) => scoreWithConfig(sb, id, config, now)))
  settled.forEach((r, i) => out.set(ids[i], r.status === 'fulfilled' ? r.value : null))
  return out
}

async function scoreWithConfig(sb, driverId, config, now) {
  const since = new Date(Number(now) - config.windowDays * 86400_000).toISOString()
  const [samples, trips, cancels, ratings] = await Promise.all([
    sb.from('driver_speed_samples').select('trip_id, speed_mps, recorded_at').eq('driver_id', driverId).gte('recorded_at', since).order('recorded_at', { ascending: false }).limit(20000),
    sb.from('trips').select('id').eq('driver_id', driverId).in('status', ['completed', 'canceled', 'cancelled_wait', 'canceled_midride']).gte('created_at', since).limit(2000),
    sb.from('trips').select('id, metadata').contains('metadata', { driver_cancels: [{ driver_id: driverId }] }).gte('created_at', since).limit(2000),
    sb.from('ratings').select('stars, tags').eq('ratee_id', driverId).gte('created_at', since).limit(2000),
  ])
  const tripIds = (trips.data || []).map((t) => t.id)
  const sos = tripIds.length ? await sb.from('sos_events').select('id', { count: 'exact', head: true }).in('trip_id', tripIds.slice(0, 500)) : { count: 0 }
  const driverCancels = (cancels.data || []).reduce((n, t) => n + (t.metadata?.driver_cancels || []).filter((c) => c.driver_id === driverId).length, 0)
  const rated = ratings.data || []
  return safetyScore({
    gps: gpsSignals(samples.error ? [] : samples.data, config),
    counts: {
      trips: tripIds.length,
      accepted: tripIds.length + driverCancels,
      driverCancels,
      sos: sos.count || 0,
      ratings: rated.length,
      lowRatings: rated.filter((r) => Number(r.stars) <= 2 || (r.tags || []).some((t) => /unsafe/i.test(t))).length,
    },
  }, config)
}
