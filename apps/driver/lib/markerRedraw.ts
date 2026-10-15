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
