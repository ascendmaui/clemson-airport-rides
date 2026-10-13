import { loadPerkConfig } from './perks.js'
import { acceptanceRate, completionRate, normalizeScorecardConfig, resolveMarker, unlockedItems, catalogEntry } from '../shared/perks/scorecard.js'

const RIDER_CANCEL = ['canceled', 'cancelled_wait', 'canceled_midride']

export async function driverScorecard(sb, driverId, now = new Date()) {
  const config = normalizeScorecardConfig(await loadPerkConfig(sb, 'scorecard', {}))
  if (!config.enabled) return { enabled: false }
  const since = new Date(Number(now) - config.windowDays * 86400_000).toISOString()
  const [alerts, passes, mine, cancelled, lifetime, profile, prefs] = await Promise.all([
    sb.from('driver_offer_alerts').select('trip_id, created_at').eq('driver_id', driverId).gte('created_at', since).order('created_at', { ascending: false }).limit(500),
    sb.from('driver_offer_passes').select('trip_id, created_at').eq('driver_id', driverId).gte('created_at', since).limit(500),
    sb.from('trips').select('id, status, accepted_at, metadata').eq('driver_id', driverId).gte('accepted_at', since).limit(1000),
    sb.from('trips').select('id, metadata').contains('metadata', { driver_cancels: [{ driver_id: driverId }] }).gte('created_at', since).limit(1000),
    sb.from('trips').select('id', { count: 'exact', head: true }).eq('driver_id', driverId).eq('status', 'completed'),
    sb.from('profiles').select('rating_avg, rating_count').eq('id', driverId).maybeSingle(),
    sb.from('driver_perk_prefs').select('map_marker').eq('driver_id', driverId).maybeSingle(),
  ])
  const offers = [...(alerts.data || []), ...(passes.data || [])].map((r) => ({ tripId: r.trip_id, at: r.created_at }))
  const accepted = new Set([...(mine.data || []).map((t) => t.id), ...(cancelled.data || []).map((t) => t.id)])
  const acceptance = acceptanceRate(offers, accepted, { windowDays: config.windowDays, maxOffers: config.maxOffers, now })
  const own = (mine.data || []).filter((t) => t.metadata?.e2e_test !== true)
  const driverCancels = (cancelled.data || []).reduce((n, t) => n + (t.metadata?.driver_cancels || []).filter((c) => c.driver_id === driverId).length, 0)
  const completion = completionRate({
    completed: own.filter((t) => t.status === 'completed').length,
    riderCancels: own.filter((t) => RIDER_CANCEL.includes(t.status)).length,
    driverCancels,
    accepted: own.filter((t) => t.status === 'completed' || RIDER_CANCEL.includes(t.status)).length + driverCancels,
  })
  const stats = {
    lifetimeTrips: lifetime.count || 0,
    rating: profile.data?.rating_avg != null ? Number(profile.data.rating_avg) : null,
    ratingCount: Number(profile.data?.rating_count) || 0,
    acceptance,
    completion,
  }
  const { milestones, unlocked } = unlockedItems(stats, config)
  return { enabled: true, windowDays: config.windowDays, ...stats, milestones, unlocked, marker: resolveMarker(prefs.data?.map_marker, unlocked) }
}

export async function setMapMarker(sb, driverId, choice) {
  const card = await driverScorecard(sb, driverId)
  const want = { style: String(choice?.style || ''), icon: String(choice?.icon || '') }
  if (!catalogEntry(want.style) || !catalogEntry(want.icon)) return { ok: false, error: 'unknown_marker' }
  if (!card.unlocked?.includes(want.style) || !card.unlocked?.includes(want.icon)) return { ok: false, error: 'locked' }
  const res = await sb.from('driver_perk_prefs').upsert({ driver_id: driverId, map_marker: want, updated_at: new Date().toISOString() }, { onConflict: 'driver_id' })
  if (res.error) return { ok: false, error: res.error.message }
  return { ok: true, marker: resolveMarker(want, card.unlocked) }
}
