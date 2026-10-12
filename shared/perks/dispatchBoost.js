/**
 * Small, configurable matching boosts. Boosts only reorder drivers who share
 * the same base dispatch rank (the John → Kim → everyone default order is
 * untouched), and rider favorites/preferred drivers still apply afterwards.
 * Demo, simulated and busy-roster cars never get a boost.
 */
export const DEFAULT_PRIORITY_CONFIG = { enabled: true, minRating: 4.9, minRatingCount: 5, minTrips: 25, boost: 1 }

export function normalizePriorityConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
  return {
    enabled: c.enabled !== false,
    minRating: num(c.minRating, DEFAULT_PRIORITY_CONFIG.minRating),
    minRatingCount: Math.max(0, num(c.minRatingCount, DEFAULT_PRIORITY_CONFIG.minRatingCount)),
    minTrips: Math.max(0, num(c.minTrips, DEFAULT_PRIORITY_CONFIG.minTrips)),
    boost: Math.max(0, Math.min(5, num(c.boost, DEFAULT_PRIORITY_CONFIG.boost))),
  }
}

/** stats: { rating, ratingCount, trips }. isFake(id) -> demo/simulated/busy roster. */
export function priorityBoost(driverId, stats, rawConfig, isFake = () => false) {
  const config = normalizePriorityConfig(rawConfig)
  if (!config.enabled || !stats || isFake(driverId)) return 0
  const rating = Number(stats.rating)
  if (!Number.isFinite(rating) || rating < config.minRating) return 0
  if ((Number(stats.ratingCount) || 0) < config.minRatingCount) return 0
  if ((Number(stats.trips) || 0) < config.minTrips) return 0
  return config.boost
}

/**
 * Stable reorder: same dispatchRank tier, higher total boost first, original
 * order otherwise. boostOf(driver) returns a number.
 */
export function applyDispatchBoosts(drivers, boostOf) {
  return (drivers || [])
    .map((driver, index) => ({ driver, index, boost: Number(boostOf(driver)) || 0 }))
    .sort((a, b) => {
      const ra = Number.isInteger(a.driver?.dispatchRank) ? a.driver.dispatchRank : 0
      const rb = Number.isInteger(b.driver?.dispatchRank) ? b.driver.dispatchRank : 0
      if (ra !== rb) return ra - rb
      return b.boost - a.boost || a.index - b.index
    })
    .map((x) => x.driver)
}
