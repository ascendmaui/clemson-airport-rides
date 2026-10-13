/**
 * Driver scorecard: acceptance, completion, average rating, and milestone
 * unlocks for cosmetic map markers. Markers never affect matching, ETA or price.
 */
export const MARKER_CATALOG = {
  colors: {
    default: { label: 'Clemson orange', fill: '#F56600', accent: '#FFFFFF' },
    tiger_orange: { label: 'Tiger orange', fill: '#E85D04', accent: '#FFFFFF' },
    regalia_purple: { label: 'Regalia purple', fill: '#522D80', accent: '#F56600' },
    midnight: { label: 'Midnight', fill: '#111827', accent: '#F59E0B' },
  },
  liveries: {
    tiger_stripe: { label: 'Tiger stripe', fill: '#F56600', accent: '#111827', pattern: 'stripe' },
    gold_rush: { label: 'Gold rush', fill: '#B45309', accent: '#FDE68A', pattern: 'ring' },
    checkered: { label: 'Checkered', fill: '#FFFFFF', accent: '#111827', pattern: 'check' },
  },
  icons: {
    car: { label: 'Car', glyph: 'car' },
    car_sport: { label: 'Sport', glyph: 'car-sport' },
    paw: { label: 'Paw', glyph: 'paw' },
    star: { label: 'Star', glyph: 'star' },
    sparkles: { label: 'Sparkles', glyph: 'sparkles' },
  },
}
export const DEFAULT_UNLOCKS = ['color:default', 'icon:car']
export const DEFAULT_MARKER = { style: 'color:default', icon: 'icon:car' }

export const DEFAULT_SCORECARD_CONFIG = {
  enabled: true, windowDays: 30, maxOffers: 100,
  milestones: [
    { id: 'trips_50', metric: 'trips', threshold: 50, unlocks: ['color:tiger_orange'] },
    { id: 'trips_100', metric: 'trips', threshold: 100, unlocks: ['color:regalia_purple', 'icon:car_sport'] },
    { id: 'trips_250', metric: 'trips', threshold: 250, unlocks: ['livery:tiger_stripe', 'icon:paw'] },
    { id: 'trips_500', metric: 'trips', threshold: 500, unlocks: ['livery:gold_rush', 'icon:star'] },
    { id: 'rating_49', metric: 'rating', threshold: 4.9, unlocks: ['color:midnight', 'icon:sparkles'] },
    { id: 'completion_95', metric: 'completion', threshold: 0.95, unlocks: ['livery:checkered'] },
  ],
}

export function normalizeScorecardConfig(raw) {
  const c = { ...DEFAULT_SCORECARD_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) }
  return {
    enabled: c.enabled !== false,
    windowDays: Math.max(1, Number(c.windowDays) || 30),
    maxOffers: Math.max(1, Number(c.maxOffers) || 100),
    milestones: (Array.isArray(c.milestones) ? c.milestones : []).filter((m) => m && m.id && ['trips', 'rating', 'completion', 'acceptance'].includes(m.metric)),
  }
}

/**
 * offers: [{ tripId, at }] (alerts + passes, deduped per trip)
 * acceptedTripIds: Set of trips this driver accepted
 * Window: last windowDays OR last maxOffers, whichever is smaller.
 */
export function acceptanceRate(offers, acceptedTripIds, { windowDays = 30, maxOffers = 100, now = Date.now() } = {}) {
  const since = Number(new Date(now)) - windowDays * 86400_000
  const latest = new Map()
  for (const o of offers || []) {
    const at = Date.parse(o.at)
    if (!o.tripId || !Number.isFinite(at) || at < since) continue
    if (!latest.has(o.tripId) || latest.get(o.tripId) < at) latest.set(o.tripId, at)
  }
  const ids = [...latest.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxOffers).map(([id]) => id)
  const accepted = ids.filter((id) => acceptedTripIds.has(id)).length
  return { offered: ids.length, accepted, rate: ids.length ? accepted / ids.length : null }
}

/** Completed / (accepted - rider cancels). Driver cancels count against; rider cancels are excluded. */
export function completionRate({ completed, driverCancels, riderCancels, accepted }) {
  const denom = Math.max(0, (Number(accepted) || 0) - (Number(riderCancels) || 0))
  const done = Math.min(Number(completed) || 0, denom)
  return { completed: done, eligible: denom, driverCancels: Number(driverCancels) || 0, rate: denom ? done / denom : null }
}

export function unlockedItems(stats, rawConfig) {
  const c = normalizeScorecardConfig(rawConfig)
  const value = { trips: stats.lifetimeTrips, rating: stats.ratingCount >= 5 ? stats.rating : null, completion: stats.completion?.eligible >= 20 ? stats.completion.rate : null, acceptance: stats.acceptance?.offered >= 20 ? stats.acceptance.rate : null }
  const milestones = c.milestones.map((m) => {
    const v = value[m.metric]
    const reached = v != null && v >= m.threshold
    return { id: m.id, metric: m.metric, threshold: m.threshold, reached, current: v, unlocks: m.unlocks || [] }
  })
  const unlocked = new Set(DEFAULT_UNLOCKS)
  for (const m of milestones) if (m.reached) for (const u of m.unlocks) unlocked.add(u)
  return { milestones, unlocked: [...unlocked] }
}

/** Validate a marker choice against unlocks; falls back to the default. */
export function resolveMarker(choice, unlocked) {
  const set = new Set(unlocked || DEFAULT_UNLOCKS)
  const style = choice?.style && set.has(choice.style) && catalogEntry(choice.style) ? choice.style : DEFAULT_MARKER.style
  const icon = choice?.icon && set.has(choice.icon) && catalogEntry(choice.icon) ? choice.icon : DEFAULT_MARKER.icon
  const s = catalogEntry(style)
  const i = catalogEntry(icon)
  return { style, icon, fill: s.fill, accent: s.accent, pattern: s.pattern || null, glyph: i.glyph }
}

export function catalogEntry(key) {
  const [kind, id] = String(key || '').split(':')
  const table = kind === 'color' ? MARKER_CATALOG.colors : kind === 'livery' ? MARKER_CATALOG.liveries : kind === 'icon' ? MARKER_CATALOG.icons : null
  return table?.[id] || null
}
