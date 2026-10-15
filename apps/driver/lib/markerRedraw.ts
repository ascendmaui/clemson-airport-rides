/**
 * Android redraws a custom <Marker> view on every map frame while
 * tracksViewChanges is true, which costs battery over a whole shift.
 * Track changes only for a short window after the marker's look changes,
 * then freeze it. Pure, so it runs under node:test.
 */
export const MARKER_SETTLE_MS = 600

/** A key for everything that changes how a custom marker looks (not where it is). */
export function markerLookKey(parts: Array<string | number | boolean | null | undefined>): string {
  return parts.map((part) => (part == null ? '' : String(part))).join('|')
}

type RouteCoord = { latitude: number; longitude: number } | null | undefined

/** Two coordinates are the same pin when both are missing or both numbers match. */
export function sameCoord(a: RouteCoord, b: RouteCoord): boolean {
  if (!a || !b) return !a && !b
  return a.latitude === b.latitude && a.longitude === b.longitude
}

/** Memo comparator for route maps: re-render only when a pin actually moves, not on every countdown tick. */
export function sameRouteProps(
  a: { driver: RouteCoord; pickup: RouteCoord; dropoff: RouteCoord },
  b: { driver: RouteCoord; pickup: RouteCoord; dropoff: RouteCoord },
): boolean {
  return sameCoord(a.driver, b.driver) && sameCoord(a.pickup, b.pickup) && sameCoord(a.dropoff, b.dropoff)
}
