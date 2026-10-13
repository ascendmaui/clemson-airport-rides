/**
 * Late-night party-ride queue. Pickups inside the College Ave zone during the
 * configured night window go first to opted-in drivers, in the order they
 * joined (FIFO), via the same tier-local dispatch boost as other perks.
 */
import { haversineKm } from './surge.js'

export const DEFAULT_PARTY_CONFIG = { enabled: true, label: 'College Ave', lat: 34.6834, lng: -82.8374, radiusKm: 0.6, startHour: 22, endHour: 3, days: [4, 5, 6], boost: 2 }

export function normalizePartyConfig(raw) {
  const c = { ...DEFAULT_PARTY_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) }
  return {
    ...c,
    enabled: c.enabled !== false,
    days: Array.isArray(c.days) ? c.days.map(Number) : DEFAULT_PARTY_CONFIG.days,
    boost: Math.max(0, Math.min(5, Number(c.boost) || 0)),
  }
}

function nyParts(at) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at))
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.find((p) => p.type === 'weekday').value]
  return { weekday: wd, hour: Number(parts.find((p) => p.type === 'hour').value) }
}

/** True inside the night window. Hours after midnight belong to the previous night's weekday. */
export function partyWindowOpen(rawConfig, at = Date.now()) {
  const c = normalizePartyConfig(rawConfig)
  if (!c.enabled) return false
  const { weekday, hour } = nyParts(at)
  const wraps = c.endHour <= c.startHour
  if (!wraps) return hour >= c.startHour && hour < c.endHour && c.days.includes(weekday)
  if (hour >= c.startHour) return c.days.includes(weekday)
  if (hour < c.endHour) return c.days.includes((weekday + 6) % 7)
  return false
}

export function inPartyZone(point, rawConfig) {
  const c = normalizePartyConfig(rawConfig)
  if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) return false
  return haversineKm({ lat: Number(point.lat), lng: Number(point.lng) }, c) <= c.radiusKm
}

/**
 * Boost function for opted-in drivers. Earlier joiners get a slightly larger
 * boost so the queue is FIFO; non-members get 0.
 */
export function partyQueueBoost(pickup, members, rawConfig, at = Date.now()) {
  const c = normalizePartyConfig(rawConfig)
  if (!c.boost || !partyWindowOpen(c, at) || !inPartyZone(pickup, c)) return null
  const ordered = [...(members || [])].sort((a, b) => Date.parse(a.joinedAt || 0) - Date.parse(b.joinedAt || 0))
  const n = ordered.length
  const score = new Map(ordered.map((m, i) => [m.driverId, c.boost + (n - i) / (n + 1)]))
  return (driver) => score.get(driver.id) || 0
}

export function partyQueueView(rawConfig, { optedIn, position, size }, at = Date.now()) {
  const c = normalizePartyConfig(rawConfig)
  return { enabled: c.enabled, label: c.label, open: partyWindowOpen(c, at), startHour: c.startHour, endHour: c.endHour, days: c.days, optedIn: Boolean(optedIn), position: position || null, size: size || 0 }
}
