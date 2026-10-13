/**
 * Rider main tabs, left to right: Rides, Schedule, Friends, Account.
 * Pure index math so swipe and tap stay on the same page.
 */

export const RIDER_MAIN_TABS = [
  { id: 'rides', href: '/', label: 'Rides', icon: 'rides' },
  { id: 'schedule', href: '/schedule', label: 'Schedule', icon: 'schedule' },
  { id: 'friends', href: '/friends', label: 'Friends', icon: 'carpool' },
  { id: 'account', href: '/account', label: 'Account', icon: 'account' },
] as const

export type RiderMainTab = (typeof RIDER_MAIN_TABS)[number]
export type RiderMainTabId = RiderMainTab['id']

/** Screen-edge band that can change tabs even when it starts on the map or sheet. */
export const TAB_SWIPE_EDGE_PX = 24

/** How far a drag must travel, as a fraction of the page width, before it turns the page. */
export const TAB_SWIPE_DISTANCE_RATIO = 0.3

/** Flick faster than this (px/s) turns the page even when the drag is short. */
export const TAB_SWIPE_VELOCITY = 700

export type TabSwipeDirection = 'next' | 'prev' | 'stay'

export type TabNavigation =
  | { type: 'tap'; index: number }
  | { type: 'swipe'; direction: TabSwipeDirection }

export type TabSwipeRect = { x: number; y: number; width: number; height: number }

export type TabSwipeStart = {
  x: number
  width: number
  onMap: boolean
  onSheet: boolean
  /** Horizontal scroller, chip row, or slider. Those gestures stay with the control. */
  onHorizontalControl: boolean
  ridesMapTab: boolean
}

function assertNever(value: never): never {
  'worklet'
  throw new Error(`Unexpected tab navigation: ${JSON.stringify(value)}`)
}

export function clampTabIndex(index: number, count = RIDER_MAIN_TABS.length): number {
  'worklet'
  if (!(count > 0)) return 0
  if (!Number.isFinite(index)) return 0
  const whole = Math.trunc(index)
  if (whole < 0) return 0
  if (whole > count - 1) return count - 1
  return whole
}

/** Next tab, clamped on the last page. */
export function nextTabIndex(index: number, count = RIDER_MAIN_TABS.length): number {
  'worklet'
  return clampTabIndex(clampTabIndex(index, count) + 1, count)
}

/** Previous tab, clamped on the first page. */
export function prevTabIndex(index: number, count = RIDER_MAIN_TABS.length): number {
  'worklet'
  return clampTabIndex(clampTabIndex(index, count) - 1, count)
}

/**
 * Tap and swipe share this step. A swipe moves one page and stops at the ends.
 * A tap lands on the tapped index, also clamped.
 */
export function applyTabNavigation(index: number, action: TabNavigation, count = RIDER_MAIN_TABS.length): number {
  'worklet'
  const current = clampTabIndex(index, count)
  switch (action.type) {
    case 'tap':
      return clampTabIndex(action.index, count)
    case 'swipe':
      switch (action.direction) {
        case 'next':
          return nextTabIndex(current, count)
        case 'prev':
          return prevTabIndex(current, count)
        case 'stay':
          return current
        default:
          return assertNever(action.direction)
      }
    default:
      return assertNever(action)
  }
}

/** Positive translationX is a finger moving right, which opens the previous tab. */
export function swipeDirection(translationX: number, velocityX: number, width: number): TabSwipeDirection {
  'worklet'
  if (!(width > 0) || !Number.isFinite(translationX) || !Number.isFinite(velocityX)) return 'stay'
  if (velocityX <= -TAB_SWIPE_VELOCITY) return 'next'
  if (velocityX >= TAB_SWIPE_VELOCITY) return 'prev'
  if (translationX <= -width * TAB_SWIPE_DISTANCE_RATIO) return 'next'
  if (translationX >= width * TAB_SWIPE_DISTANCE_RATIO) return 'prev'
  return 'stay'
}

export function tabRequiresAuth(id: string): boolean {
  return id === 'schedule' || id === 'account'
}

export function normalizeTabPath(pathname: string): string {
  const bare = pathname.split('?')[0].replace(/\/$/, '') || '/'
  if (bare === '/index' || bare === '/(tabs)' || bare === '/(tabs)/index') return '/'
  if (bare.startsWith('/(tabs)/')) {
    const rest = bare.slice('/(tabs)'.length)
    return rest || '/'
  }
  return bare
}

export function tabIndexForPath(pathname: string): number {
  const path = normalizeTabPath(pathname)
  const found = RIDER_MAIN_TABS.findIndex((tab) => tab.href === path)
  return found < 0 ? 0 : found
}

export function pointInRect(x: number, y: number, rect: TabSwipeRect | null | undefined): boolean {
  'worklet'
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return false
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
}

export function tabSwipeAllowed(start: TabSwipeStart): boolean {
  'worklet'
  if (start.onHorizontalControl) return false
  if (!(start.width > 0)) return false
  const edge = start.x <= TAB_SWIPE_EDGE_PX || start.x >= start.width - TAB_SWIPE_EDGE_PX
  if (edge) return true
  if (start.ridesMapTab && (start.onMap || start.onSheet)) return false
  return true
}

export function tabSwipeStartFromPoint(input: {
  x: number
  y: number
  width: number
  ridesMapTab: boolean
  map: TabSwipeRect | null
  sheet: TabSwipeRect | null
  horizontal: readonly TabSwipeRect[]
}): TabSwipeStart {
  'worklet'
  let onHorizontalControl = false
  for (let i = 0; i < input.horizontal.length; i++) {
    if (pointInRect(input.x, input.y, input.horizontal[i])) {
      onHorizontalControl = true
      break
    }
  }
  return {
    x: input.x,
    width: input.width,
    ridesMapTab: input.ridesMapTab,
    onMap: pointInRect(input.x, input.y, input.map),
    onSheet: pointInRect(input.x, input.y, input.sheet),
    onHorizontalControl,
  }
}
