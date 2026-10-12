import { loadPerkConfig } from './perks.js'
import { driverSurgeView, surgeAwards, surgeZones, zoneBoost, zoneFor, normalizeSurgeConfig } from '../shared/perks/surge.js'

export async function loadSurgeZones(sb, now = new Date()) {
  const config = await loadPerkConfig(sb, 'game_day_surge', {})
  const from = new Date(Number(now) - 7 * 24 * 3600_000).toISOString()
  const events = await sb.from('game_day_events')
    .select('id, title, starts_at, ends_at, pickup_zone_label, pickup_lat, pickup_lng, active')
    .eq('active', true).gte('ends_at', from).limit(200)
  return { config, zones: surgeZones(events.error ? [] : events.data, config) }
}

export async function surgeSummary(sb, now = new Date()) {
  const { config, zones } = await loadSurgeZones(sb, now)
  return driverSurgeView(zones, config, now)
}

export async function surgeBonusAwards(sb, trips, now = new Date()) {
  const { config, zones } = await loadSurgeZones(sb, now)
  return surgeAwards(trips, zones, config)
}

/** extraBoost for boostAssignableDrivers when the pickup is in a live zone. */
export async function surgeExtraBoost(sb, pickup, drivers, now = new Date()) {
  if (!pickup) return null
  const { config, zones } = await loadSurgeZones(sb, now)
  const cfg = normalizeSurgeConfig(config)
  if (!cfg.enabled || !zoneFor(pickup, zones, cfg.radiusKm, now)) return null
  const locs = await sb.from('driver_status').select('driver_id, lat, lng').in('driver_id', drivers.map((d) => d.id))
  if (locs.error) return null
  const byId = new Map((locs.data || []).map((r) => [r.driver_id, { lat: r.lat, lng: r.lng }]))
  return (driver) => zoneBoost(byId.get(driver.id), pickup, zones, config, now)
}
