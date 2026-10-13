/**
 * Game-day surge zones for drivers. Zones come from game_day_events (the
 * game schedule) plus optional config zones (forecast/other schedule feeds).
 * Rider fares are NOT changed here; the driver bonus is paid from config into
 * the bonus ledger.
 */
export const DEFAULT_SURGE_CONFIG = { enabled: true, radiusKm: 1.5, driverBonusCents: 300, zoneBoost: 1, leadHours: 36, zones: [] }

export function normalizeSurgeConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
  return {
    enabled: c.enabled !== false,
    radiusKm: Math.max(0.1, num(c.radiusKm, DEFAULT_SURGE_CONFIG.radiusKm)),
    driverBonusCents: Math.max(0, Math.round(num(c.driverBonusCents, DEFAULT_SURGE_CONFIG.driverBonusCents))),
    zoneBoost: Math.max(0, Math.min(5, num(c.zoneBoost, DEFAULT_SURGE_CONFIG.zoneBoost))),
    leadHours: Math.max(1, num(c.leadHours, DEFAULT_SURGE_CONFIG.leadHours)),
    startsAt: c.startsAt && Number.isFinite(Date.parse(c.startsAt)) ? Date.parse(c.startsAt) : Number.POSITIVE_INFINITY,
    zones: Array.isArray(c.zones) ? c.zones : [],
  }
}

export function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

const okPoint = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))

/** Merge game_day_events rows and config zones into one shape. */
export function surgeZones(events, rawConfig) {
  const config = normalizeSurgeConfig(rawConfig)
  const out = []
  for (const e of events || []) {
    if (e?.active === false) continue
    const point = { lat: Number(e.pickup_lat), lng: Number(e.pickup_lng) }
    if (!okPoint(point)) continue
    out.push({ id: `event:${e.id}`, title: e.title || 'Game day', label: e.pickup_zone_label || null, ...point, startsAt: e.starts_at, endsAt: e.ends_at, source: 'game_day' })
  }
  for (const [i, z] of config.zones.entries()) {
    if (!okPoint(z) || !z.startsAt || !z.endsAt) continue
    out.push({ id: `config:${z.id || i}`, title: z.title || 'Event', label: z.label || null, lat: Number(z.lat), lng: Number(z.lng), startsAt: z.startsAt, endsAt: z.endsAt, source: z.source || 'config' })
  }
  return out
}

export function zoneLive(zone, now = Date.now()) {
  const t = Number(new Date(now))
  return Date.parse(zone.startsAt) <= t && t <= Date.parse(zone.endsAt)
}

/** Live and upcoming (within leadHours) zones, soonest first, for the driver Home. */
export function driverSurgeView(zones, rawConfig, now = Date.now()) {
  const config = normalizeSurgeConfig(rawConfig)
  if (!config.enabled) return { enabled: false, zones: [] }
  const t = Number(new Date(now))
  const horizon = t + config.leadHours * 3600_000
  const list = (zones || [])
    .filter((z) => Date.parse(z.endsAt) >= t && Date.parse(z.startsAt) <= horizon)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .map((z) => ({ ...z, live: zoneLive(z, t) }))
  return { enabled: true, radiusKm: config.radiusKm, driverBonusCents: config.driverBonusCents, zones: list }
}

export function zoneFor(point, zones, radiusKm, at = Date.now()) {
  if (!okPoint(point)) return null
  return (zones || []).find((z) => zoneLive(z, at) && haversineKm(point, z) <= radiusKm) || null
}

/** Matching boost: pickup in a live zone and the driver is near that zone. */
export function zoneBoost(driverLoc, pickup, zones, rawConfig, now = Date.now()) {
  const config = normalizeSurgeConfig(rawConfig)
  if (!config.enabled || !config.zoneBoost) return 0
  const zone = zoneFor(pickup, zones, config.radiusKm, now)
  if (!zone || !okPoint(driverLoc)) return 0
  return haversineKm(driverLoc, zone) <= config.radiusKm ? config.zoneBoost : 0
}

/** Driver bonus for completed trips picked up in a live zone (after startsAt). */
export function surgeAwards(trips, zones, rawConfig) {
  const config = normalizeSurgeConfig(rawConfig)
  if (!config.enabled || config.driverBonusCents <= 0) return []
  const out = []
  for (const t of trips || []) {
    if (t?.status !== 'completed' || t?.metadata?.e2e_test === true) continue
    const at = Date.parse(t.accepted_at || t.started_at || t.completed_at)
    if (!Number.isFinite(at) || at < config.startsAt) continue
    const zone = zoneFor({ lat: t.pickup_lat, lng: t.pickup_lng }, zones, config.radiusKm, at)
    if (zone) out.push({ kind: 'surge', ref: `trip:${t.id}`, tripId: t.id, amountCents: config.driverBonusCents, metadata: { zone: zone.id } })
  }
  return out
}
