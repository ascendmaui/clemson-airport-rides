/**
 * Driver auto-accept rules.
 * Favorite riders match on their own.
 * Distance and hourly rate, when enabled, must both pass.
 */

export const PICKUP_MILE_CHOICES = Object.freeze([1, 2, 3, 5, 10])
export const HOURLY_CENTS_CHOICES = Object.freeze([1500, 2000, 2500, 3000, 4000])

export function defaultAutoAccept() {
  return {
    distanceEnabled: false,
    maxPickupMiles: 3,
    hourlyEnabled: false,
    minHourlyCents: 2000,
    favoritesEnabled: false,
    favoriteRiders: [],
  }
}

function finiteNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function favoriteList(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const riders = []
  for (const row of raw) {
    const id = String(row?.id || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = String(row?.name || 'Rider').trim() || 'Rider'
    riders.push({ id, name })
  }
  return riders.slice(0, 50)
}

export function normalizeAutoAccept(raw) {
  const defaults = defaultAutoAccept()
  const source = raw && typeof raw === 'object' ? raw : {}
  const miles = finiteNumber(source.maxPickupMiles, defaults.maxPickupMiles)
  const hourly = finiteNumber(source.minHourlyCents, defaults.minHourlyCents)
  return {
    distanceEnabled: Boolean(source.distanceEnabled),
    maxPickupMiles: Math.min(50, Math.max(0.5, miles)),
    hourlyEnabled: Boolean(source.hourlyEnabled),
    minHourlyCents: Math.min(50000, Math.max(0, Math.round(hourly))),
    favoritesEnabled: Boolean(source.favoritesEnabled),
    favoriteRiders: favoriteList(source.favoriteRiders),
  }
}

export function isFavoriteRider(settings, riderId) {
  if (!riderId) return false
  return normalizeAutoAccept(settings).favoriteRiders.some((rider) => rider.id === riderId)
}

export function withFavoriteRider(settings, rider) {
  const next = normalizeAutoAccept(settings)
  const id = String(rider?.id || '').trim()
  if (!id) return next
  const name = String(rider?.name || 'Rider').trim() || 'Rider'
  const rest = next.favoriteRiders.filter((row) => row.id !== id)
  return { ...next, favoriteRiders: [{ id, name }, ...rest].slice(0, 50) }
}

export function withoutFavoriteRider(settings, riderId) {
  const next = normalizeAutoAccept(settings)
  return { ...next, favoriteRiders: next.favoriteRiders.filter((row) => row.id !== riderId) }
}

/**
 * @returns {{ accept: boolean, reason: string }}
 */
export function shouldAutoAccept(offer, settings) {
  const prefs = normalizeAutoAccept(settings)
  if (!prefs.distanceEnabled && !prefs.hourlyEnabled && !prefs.favoritesEnabled) {
    return { accept: false, reason: 'off' }
  }
  const riderId = offer?.riderId || offer?.rider_id || null
  if (prefs.favoritesEnabled && isFavoriteRider(prefs, riderId)) {
    return { accept: true, reason: 'favorite_rider' }
  }
  if (!prefs.distanceEnabled && !prefs.hourlyEnabled) {
    return { accept: false, reason: 'not_favorite' }
  }
  if (prefs.distanceEnabled) {
    const miles = offer?.pickupMiles
    if (miles == null || !Number.isFinite(Number(miles)) || Number(miles) > prefs.maxPickupMiles) {
      return { accept: false, reason: 'beyond_distance' }
    }
  }
  if (prefs.hourlyEnabled) {
    const hourly = offer?.hourlyCents
    if (hourly == null || !Number.isFinite(Number(hourly)) || Number(hourly) < prefs.minHourlyCents) {
      return { accept: false, reason: 'below_hourly' }
    }
  }
  if (prefs.distanceEnabled && prefs.hourlyEnabled) return { accept: true, reason: 'distance_and_hourly' }
  if (prefs.distanceEnabled) return { accept: true, reason: 'distance' }
  return { accept: true, reason: 'hourly' }
}
