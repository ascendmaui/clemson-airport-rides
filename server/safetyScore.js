import { loadPerkConfig } from './perks.js'
import { gpsSignals, normalizeSafetyConfig, safetyScore } from '../shared/perks/safetyScore.js'

export async function driverSafetyScore(sb, driverId, now = new Date()) {
  const config = normalizeSafetyConfig(await loadPerkConfig(sb, 'safety_score', {}))
  if (!config.enabled) return { enabled: false }
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
