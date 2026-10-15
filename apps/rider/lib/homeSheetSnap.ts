/**
 * Snap points for the rider home sheet. Heights are the sheet's own height:
 * larger means more open. A positive velocity is a finger moving down, which
 * shortens the sheet toward the collapsed snap.
 *
 * Every helper worklet is declared before the worklets that call it. The
 * worklets plugin captures callees by value when it initializes each worklet,
 * and the Expo preset then lowers those bindings to `var`. A helper declared
 * later is undefined on the first call.
 */

/** How long a release velocity is projected when picking a detent, in seconds. */
export const HOME_SHEET_SNAP_PROJECTION_S = 0.35

/** Map fractions the home screen already used before the collapsed snap existed. */
export const HOME_SHEET_MAP_MIN_RATIO = 0.38
export const HOME_SHEET_MAP_MAX_RATIO = 0.64

/** Gap under the search field so it sits above the tab bar, clear of the home indicator. */
export const HOME_SHEET_BOTTOM_PADDING = 12

/** Native tab bar content above the home indicator. The screen pads by this plus the inset. */
export const NATIVE_TAB_CONTENT_HEIGHT = 56

export function homeTabClearance(bottomInset: number): number {
  const inset = Number.isFinite(bottomInset) ? Math.max(0, bottomInset) : 0
  return inset + NATIVE_TAB_CONTENT_HEIGHT
}

/** Until the handle lays out: paddingTop 8 + handle margins and bar (4 + 4 + 10). */
export const HOME_SHEET_HANDLE_FALLBACK = 26

/** Until the prompt and field lay out: prompt block plus the 56pt field. */
export const HOME_SHEET_SEARCH_FALLBACK = 106

/** UI-thread spring. Overshoot is clamped so the collapsed field is never clipped. */
export const HOME_SHEET_SPRING = {
  damping: 24,
  stiffness: 280,
  mass: 0.8,
  overshootClamping: true,
  restDisplacementThreshold: 0.5,
  restSpeedThreshold: 0.5,
}

export type HomeSheetDetent = 'collapsed' | 'expanded'

function pushUnique(points: number[], height: number) {
  'worklet'
  for (let i = 0; i < points.length; i++) {
    if (points[i] === height) return
  }
  points.push(height)
}

function sortAscending(points: number[]): number[] {
  'worklet'
  for (let i = 1; i < points.length; i++) {
    const value = points[i]
    let j = i - 1
    while (j >= 0 && points[j] > value) {
      points[j + 1] = points[j]
      j -= 1
    }
    points[j + 1] = value
  }
  return points
}

function nearestSnap(points: readonly number[], position: number): number {
  'worklet'
  let best = points[0]
  let bestDist = Math.abs(position - best)
  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    const dist = Math.abs(position - point)
    if (dist < bestDist || (dist === bestDist && point > best)) {
      best = point
      bestDist = dist
    }
  }
  return best
}

export function collapsedSheetPadding(handleHeight: number, bottomPadding: number): number {
  'worklet'
  const handle = Number.isFinite(handleHeight) ? Math.max(0, handleHeight) : 0
  const bottom = Number.isFinite(bottomPadding) ? Math.max(0, bottomPadding) : 0
  return handle + bottom
}

/** Collapsed sheet height: the search field, plus the padding around it. */
export function collapsedSheetHeight(searchFieldHeight: number, padding: number): number {
  'worklet'
  const field = Number.isFinite(searchFieldHeight) ? Math.max(0, searchFieldHeight) : 0
  const pad = Number.isFinite(padding) ? Math.max(0, padding) : 0
  return field + pad
}

/** Sheet heights that keep today's map sizes: 38% (sheet open) and 64% (more map). */
export function expandedSheetHeights(windowHeight: number, tabBarHeight: number): number[] {
  'worklet'
  const windowH = Number.isFinite(windowHeight) ? Math.max(0, windowHeight) : 0
  const tabH = Number.isFinite(tabBarHeight) ? Math.max(0, tabBarHeight) : 0
  const minMap = Math.round(windowH * HOME_SHEET_MAP_MIN_RATIO)
  const maxMap = Math.round(windowH * HOME_SHEET_MAP_MAX_RATIO)
  const open = windowH - tabH - minMap
  const mid = windowH - tabH - maxMap
  const heights: number[] = []
  if (mid > 0) heights.push(mid)
  if (open > 0 && open !== mid) heights.push(open)
  return sortAscending(heights)
}

export function homeSheetSnapPoints(input: {
  searchFieldHeight: number
  padding: number
  expandedHeights: readonly number[]
}): number[] {
  'worklet'
  const collapsed = collapsedSheetHeight(input.searchFieldHeight, input.padding)
  const points: number[] = [collapsed]
  const expanded = input.expandedHeights
  for (let i = 0; i < expanded.length; i++) {
    const height = expanded[i]
    if (!Number.isFinite(height) || height <= collapsed) continue
    pushUnique(points, height)
  }
  return sortAscending(points)
}

function finiteSorted(values: readonly number[]): number[] {
  'worklet'
  const points: number[] = []
  for (let i = 0; i < values.length; i++) {
    const height = values[i]
    if (Number.isFinite(height)) pushUnique(points, height)
  }
  return sortAscending(points)
}

export function buildHomeSheetSnapPoints(input: {
  windowHeight: number
  tabBarHeight: number
  searchFieldHeight: number
  handleHeight: number
  bottomPadding: number
}): number[] {
  'worklet'
  return homeSheetSnapPoints({
    searchFieldHeight: input.searchFieldHeight,
    padding: collapsedSheetPadding(input.handleHeight, input.bottomPadding),
    expandedHeights: expandedSheetHeights(input.windowHeight, input.tabBarHeight),
  })
}

export function indexOfSnap(snapPoints: readonly number[], height: number): number {
  'worklet'
  if (snapPoints.length === 0) return 0
  let best = 0
  let bestDist = Math.abs(snapPoints[0] - height)
  for (let i = 1; i < snapPoints.length; i++) {
    const dist = Math.abs(snapPoints[i] - height)
    if (dist < bestDist) {
      best = i
      bestDist = dist
    }
  }
  return best
}

/**
 * Project the release and pick the nearest snap. A fast downward flick from
 * the open sheet can reach collapsed; a short drag settles on the nearer
 * existing expanded height. Ties keep the taller sheet.
 */
export function snapHomeSheet(input: {
  position: number
  velocity: number
  snapPoints: readonly number[]
}): { height: number; detent: HomeSheetDetent } {
  'worklet'
  const points = finiteSorted(input.snapPoints)
  if (points.length === 0) return { height: 0, detent: 'collapsed' }
  const collapsed = points[0]
  const position = Number.isFinite(input.position) ? input.position : collapsed
  const velocity = Number.isFinite(input.velocity) ? input.velocity : 0
  const projected = position - velocity * HOME_SHEET_SNAP_PROJECTION_S
  const height = nearestSnap(points, projected)
  const detent: HomeSheetDetent = height === collapsed ? 'collapsed' : 'expanded'
  return { height, detent }
}
