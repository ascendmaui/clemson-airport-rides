/**
 * Tiger Heat Map zones.
 *
 * Each campus anchor keeps the busy-time curve from heat.js, so Friday night,
 * Saturday at the stadium, and a weekday morning light up different places.
 * A zone becomes payable only from real pickup density in the live window.
 * Clock-only heat is preview: it draws the zone and the dollar label, and it
 * does not reserve driver pay.
 *
 * Bonuses are flat dollars, scaled by how many requests sit in the zone:
 *   4 requests  → $10  (common peak)
 *   8 requests  → $20  (great)
 *   12 requests → $30  (rare cap)
 * Counts in between round to the nearest dollar.
 */

import { CAMPUS_ANCHORS, DOWNTOWN_VENUES, previewDate, typicalSpots } from './heat.js'

export const TIGER_HEAT_ORANGE = '#F56600'
export const TIGER_HEAT_PURPLE = '#522D80'
export const TIGER_HEAT_LABEL = 'Tiger Heat'

export const LIVE_WINDOW_MS = 90 * 60 * 1000
export const LIVE_MIN_REQUESTS = 4
export const PREVIEW_INTENSITY = 0.75
export const BONUS_CAP_CENTS = 3000
export const DURATION_BASELINE_MINUTES = 15
export const DURATION_CENTS_PER_MINUTE = 25
export const DURATION_GAME_DAY_CENTS_PER_MINUTE = 50

const EARTH_M = 6371000
const POLY_STEPS = 24

export const TIGER_HEAT_ZONES = [...DOWNTOWN_VENUES, ...CAMPUS_ANCHORS]

function clamp01(n) {
  return Math.max(0, Math.min(1, n))
}

function assertNever(value) {
  throw new Error(`Unhandled Tiger Heat activation: ${String(value)}`)
}

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const aLat = Number(lat1)
  const aLng = Number(lng1)
  const bLat = Number(lat2)
  const bLng = Number(lng2)
  if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) return null
  const p1 = (aLat * Math.PI) / 180
  const p2 = (bLat * Math.PI) / 180
  const dp = ((bLat - aLat) * Math.PI) / 180
  const dl = ((bLng - aLng) * Math.PI) / 180
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function offsetPoint(lat, lng, radiusM, bearingRad) {
  const delta = radiusM / EARTH_M
  const phi1 = (lat * Math.PI) / 180
  const lambda1 = (lng * Math.PI) / 180
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(bearingRad),
  )
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(bearingRad) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
  )
  return {
    lat: (phi2 * 180) / Math.PI,
    lng: (((lambda2 * 180) / Math.PI + 540) % 360) - 180,
  }
}

export function circlePolygon(lat, lng, radiusM, steps = POLY_STEPS) {
  const count = Math.max(8, Math.round(steps))
  const ring = []
  for (let i = 0; i < count; i += 1) {
    ring.push(offsetPoint(lat, lng, radiusM, (i / count) * Math.PI * 2))
  }
  return ring
}

export function toNativeRing(polygon) {
  return (polygon || []).map((point) => ({
    latitude: point.lat,
    longitude: point.lng,
  }))
}

/** Flat dollars from live request count. 0 when the zone is not hot enough. */
export function bonusCentsFromRequestCount(count) {
  const n = Math.floor(Number(count) || 0)
  if (n < LIVE_MIN_REQUESTS) return 0
  const capped = Math.min(n, 12)
  const dollars = Math.round(10 + (capped - 4) * 2.5)
  return Math.min(BONUS_CAP_CENTS, dollars * 100)
}

/** Flat dollars from a preview intensity curve. Not payable. */
export function bonusCentsFromPreviewIntensity(intensity) {
  const value = Number(intensity)
  if (!Number.isFinite(value) || value < PREVIEW_INTENSITY) return 0
  const t = clamp01((Math.min(1, value) - PREVIEW_INTENSITY) / (1 - PREVIEW_INTENSITY))
  const dollars = Math.round(10 + t * 20)
  return Math.min(BONUS_CAP_CENTS, Math.max(1000, dollars * 100))
}

export function heatLevelForCents(cents) {
  const n = Math.round(Number(cents) || 0)
  if (n >= 2500) return 'rare'
  if (n >= 1500) return 'great'
  if (n >= 1000) return 'peak'
  if (n > 0) return 'reduced'
  return null
}

export function formatTigerHeatLabel(bonusCents, { preview = false } = {}) {
  const dollars = Math.max(0, Math.round((Number(bonusCents) || 0) / 100))
  const money = `${TIGER_HEAT_LABEL} · +$${dollars}`
  return preview ? `Preview · ${money}` : money
}

/**
 * Longer trips add flat dollars, more when game-day traffic is on.
 * The stack stays inside the $30 cap. A ride at or under the baseline
 * keeps the zone's demand bonus unchanged.
 */
export function applyDurationBonus(baseCents, durationMinutes, gameDay = false) {
  const base = Math.max(0, Math.min(BONUS_CAP_CENTS, Math.round(Number(baseCents) || 0)))
  if (base <= 0) {
    return { bonusCents: 0, durationAdjustmentCents: 0, capped: false }
  }
  const minutes = Number(durationMinutes)
  const extra = Number.isFinite(minutes) ? Math.max(0, minutes - DURATION_BASELINE_MINUTES) : 0
  const rate = gameDay ? DURATION_GAME_DAY_CENTS_PER_MINUTE : DURATION_CENTS_PER_MINUTE
  const bump = Math.round(extra * rate / 100) * 100
  const room = BONUS_CAP_CENTS - base
  const durationAdjustmentCents = Math.min(room, Math.max(0, bump))
  return {
    bonusCents: base + durationAdjustmentCents,
    durationAdjustmentCents,
    capped: bump > room,
  }
}

export function tripDurationMinutes(trip, completedAt = new Date()) {
  const end = new Date(completedAt).getTime()
  const startRaw = trip?.accepted_at || trip?.created_at
  const start = startRaw ? new Date(startRaw).getTime() : end
  if (!Number.isFinite(end) || !Number.isFinite(start)) return DURATION_BASELINE_MINUTES
  return Math.max(0, (end - start) / 60000)
}

function intensityMap(at) {
  const map = new Map()
  for (const spot of typicalSpots(at)) map.set(spot.id, clamp01(spot.intensity))
  return map
}

export function countRequestsInZone(zone, requests) {
  let count = 0
  for (const point of requests || []) {
    const dist = distanceMeters(zone.lat, zone.lng, point.lat ?? point.pickup_lat, point.lng ?? point.pickup_lng)
    if (dist != null && dist <= zone.radius) count += 1
  }
  return count
}

function buildZone(zone, { bonusCents, requestCount, intensity, payable, preview, source }) {
  const radius = zone.radius
  return {
    id: zone.id,
    name: zone.name,
    lat: zone.lat,
    lng: zone.lng,
    radius,
    requestCount,
    intensity,
    bonusCents,
    bonusLabel: formatTigerHeatLabel(bonusCents, { preview: preview || !payable }),
    payable: Boolean(payable),
    preview: Boolean(preview || !payable),
    source,
    heatLevel: heatLevelForCents(bonusCents),
    fillColor: TIGER_HEAT_ORANGE,
    strokeColor: TIGER_HEAT_PURPLE,
    polygon: circlePolygon(zone.lat, zone.lng, radius),
    innerPolygon: circlePolygon(zone.lat, zone.lng, Math.round(radius * 0.55), 16),
  }
}

export function resizeZone(zone, radius, bonusCents) {
  const nextRadius = Math.max(40, Math.round(radius))
  const preview = zone.preview || !zone.payable
  return {
    ...zone,
    radius: nextRadius,
    bonusCents,
    bonusLabel: formatTigerHeatLabel(bonusCents, { preview }),
    heatLevel: heatLevelForCents(bonusCents),
    polygon: circlePolygon(zone.lat, zone.lng, nextRadius),
    innerPolygon: circlePolygon(zone.lat, zone.lng, Math.round(nextRadius * 0.55), 16),
  }
}

/**
 * @param {'live'|'preview-clock'|'preview-history'} activation
 */
export function evaluateTigerHeat({ at = new Date(), requests = [], activation = 'live' } = {}) {
  const when = at instanceof Date ? at : new Date(at)
  const clock = intensityMap(when)
  const payable = []
  const preview = []

  if (activation === 'live' || activation === 'preview-history') {
    for (const zone of TIGER_HEAT_ZONES) {
      const requestCount = countRequestsInZone(zone, requests)
      const bonusCents = bonusCentsFromRequestCount(requestCount)
      if (bonusCents <= 0) continue
      const isLive = activation === 'live'
      const built = buildZone(zone, {
        bonusCents,
        requestCount,
        intensity: Math.min(1, requestCount / 12),
        payable: isLive,
        preview: !isLive,
        source: isLive ? 'live' : 'history',
      })
      if (isLive) payable.push(built)
      else preview.push(built)
    }
  } else if (activation === 'preview-clock') {
    for (const zone of TIGER_HEAT_ZONES) {
      const intensity = clock.get(zone.id) || 0
      const bonusCents = bonusCentsFromPreviewIntensity(intensity)
      if (bonusCents <= 0) continue
      preview.push(buildZone(zone, {
        bonusCents,
        requestCount: 0,
        intensity,
        payable: false,
        preview: true,
        source: 'preview',
      }))
    }
  } else {
    assertNever(activation)
  }

  if (activation === 'live') {
    const liveIds = new Set(payable.map((zone) => zone.id))
    for (const zone of TIGER_HEAT_ZONES) {
      if (liveIds.has(zone.id)) continue
      const intensity = clock.get(zone.id) || 0
      const bonusCents = bonusCentsFromPreviewIntensity(intensity)
      if (bonusCents <= 0) continue
      preview.push(buildZone(zone, {
        bonusCents,
        requestCount: 0,
        intensity,
        payable: false,
        preview: true,
        source: 'preview',
      }))
    }
  }

  return {
    at: when.toISOString(),
    activation,
    zones: [...payable, ...preview],
    payableZones: payable,
    previewZones: preview,
  }
}

export function zoneContains(zone, lat, lng) {
  const dist = distanceMeters(zone?.lat, zone?.lng, lat, lng)
  if (dist == null) return false
  return dist <= Number(zone.radius)
}

export function bestPayableZone(lat, lng, zones) {
  const hits = (zones || []).filter((zone) => zone.payable && zoneContains(zone, lat, lng))
  hits.sort((a, b) => b.bonusCents - a.bonusCents || a.radius - b.radius)
  return hits[0] || null
}

export function heatWindowActivation(windowId) {
  if (windowId === 'weekday_am' || windowId === 'friday_night') return 'preview-clock'
  if (windowId === 'last_7d') return 'preview-history'
  return 'live'
}

export function tigerHeatAnchor(windowId, now = new Date()) {
  if (windowId === 'weekday_am' || windowId === 'friday_night') return previewDate(windowId, now)
  return now
}

export function normalizeTigerHeatMap(body) {
  const zones = Array.isArray(body?.zones)
    ? body.zones.filter((zone) => Number.isFinite(Number(zone?.lat)) && Number.isFinite(Number(zone?.lng)) && Number(zone?.bonusCents) > 0)
    : []
  return {
    label: TIGER_HEAT_LABEL,
    windowId: body?.windowId || 'now',
    activation: body?.activation || 'live',
    zones,
    deactivated: Array.isArray(body?.deactivated) ? body.deactivated : [],
    solvency: body?.solvency || null,
    durationPolicy: body?.durationPolicy || null,
    error: body?.error || null,
  }
}
