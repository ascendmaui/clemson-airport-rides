/**
 * Android redraws a custom Marker view on every map frame while
 * tracksViewChanges stays true. Track for a short window after the first
 * paint (and after the look changes), then freeze. Position still updates
 * through the coordinate prop. Pure, so it runs under node:test.
 */
export const MARKER_SETTLE_MS = 600

/** True only during the first-paint window. After that the marker bitmap is frozen. */
export function tracksMarkerView(elapsedMs: number): boolean {
  return elapsedMs >= 0 && elapsedMs < MARKER_SETTLE_MS
}

/** A key for everything that changes how a custom marker looks, not where it sits. */
export function markerLookKey(parts: Array<string | number | boolean | null | undefined>): string {
  return parts.map((part) => (part == null ? '' : String(part))).join('|')
}
