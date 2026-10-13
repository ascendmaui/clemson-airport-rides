/**
 * Rider favorite drivers used by Pick a driver and by matching.
 * Demo map cars and simulated busy markers are never favorites.
 */
import { isDemoDriverId } from './demoFleet.js'

export const FAVORITE_DRIVER_CAP = 12

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Map preview cars and the older simulated-busy ids. */
export function isPreviewDriverId(id) {
  const key = String(id || '').trim()
  if (!key) return false
  if (key.startsWith('sim-busy-')) return true
  if (key.startsWith('demo-')) return true
  return isDemoDriverId(key)
}

/**
 * Ids that may be stored and used for matching.
 * Non-uuids are dropped. Preview cars are dropped even if a later id shape changes.
 */
export function favoriteIdsForMatching(raw) {
  const list = Array.isArray(raw) ? raw : []
  const ids = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!id || isPreviewDriverId(id) || !UUID_RE.test(id) || ids.includes(id)) continue
    ids.push(id)
    if (ids.length >= FAVORITE_DRIVER_CAP) break
  }
  return ids
}

function preferenceRank(id, preferred, favorite) {
  if (preferred.has(id)) return 0
  if (favorite.has(id)) return 1
  return 2
}

/**
 * Stable order: active-pass preferred drivers, then other favorites, then the
 * caller's existing order (default dispatch rank). Preview ids never promote.
 */
export function orderDriversForRider(drivers, { preferredIds = [], favoriteIds = [] } = {}) {
  const preferred = new Set(favoriteIdsForMatching(preferredIds))
  const favorite = new Set(favoriteIdsForMatching(favoriteIds))
  return (Array.isArray(drivers) ? drivers : [])
    .map((driver, index) => ({ driver, index }))
    .sort((a, b) => {
      const delta = preferenceRank(a.driver?.id, preferred, favorite) - preferenceRank(b.driver?.id, preferred, favorite)
      if (delta !== 0) return delta
      return a.index - b.index
    })
    .map((row) => row.driver)
}
