import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
  type StyleProp,
  type ViewStyle,
} from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { SPRING } from 'rides-native/icons'
import {
  RIDER_MAIN_TABS,
  applyTabNavigation,
  clampTabIndex,
  swipeDirection,
  tabRequiresAuth,
  tabSwipeAllowed,
  tabSwipeStartFromPoint,
  type TabSwipeRect,
} from '@/lib/tabSwipe'

const TAB_COUNT = RIDER_MAIN_TABS.length
const PAGE_SPRING = { ...SPRING, overshootClamping: true }

type Kind = 'map' | 'sheet' | 'horizontal'

type MeasureHost = {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void
}

type Api = {
  report: (id: string, kind: Kind, rect: TabSwipeRect | null) => void
  remeasureAll: () => void
  watch: (id: string, measure: () => void) => () => void
}

const TabSwipeContext = createContext<Api | null>(null)

function authBitmask(): number {
  let mask = 0
  RIDER_MAIN_TABS.forEach((tab, index) => {
    if (tabRequiresAuth(tab.id)) mask |= 1 << index
  })
  return mask
}

function resist(value: number, min: number, max: number) {
  'worklet'
  if (value > max) return max + (value - max) * 0.28
  if (value < min) return min + (value - min) * 0.28
  return value
}

function pageBlocked(index: number, mask: number, signedIn: number) {
  'worklet'
  if (signedIn) return false
  return (mask & (1 << index)) !== 0
}

/** Re-read horizontal controls after a vertical scroll moves them. */
export function useTabSwipeRemeasure() {
  const api = useContext(TabSwipeContext)
  return useCallback(() => {
    api?.remeasureAll()
  }, [api])
}

/** Attach to an existing view so its window rect can block tab swipes. */
export function useTabSwipeMeasure(kind: Kind) {
  const api = useContext(TabSwipeContext)
  const id = useId()
  const host = useRef<MeasureHost | null>(null)
  const measure = useCallback(() => {
    const node = host.current as (MeasureHost & { getNode?: () => MeasureHost }) | null
    const target = node && typeof node.measureInWindow === 'function' ? node : node?.getNode?.()
    if (!target || typeof target.measureInWindow !== 'function' || !api) return
    target.measureInWindow((x, y, width, height) => {
      api.report(id, kind, width > 0 && height > 0 ? { x, y, width, height } : null)
    })
  }, [api, id, kind])
  useEffect(() => {
    if (!api) return undefined
    return api.watch(id, measure)
  }, [api, id, measure])
  useEffect(() => () => api?.report(id, kind, null), [api, id, kind])
  return { ref: host, onLayout: measure }
}

/**
 * Marks a horizontal scroller, chip row, or slider. Drags that start here
 * stay with that control.
 */
export function TabSwipeRegion({
  children,
  style,
  kind = 'horizontal',
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  kind?: Kind
}) {
  const measure = useTabSwipeMeasure(kind)
  return (
    <View
      ref={measure.ref as RefObject<View | null>}
      collapsable={false}
      onLayout={measure.onLayout}
      style={style}
    >
      {children}
    </View>
  )
}

type PagerProps = {
  index: number
  reduceMotion: boolean
  signedIn: boolean
  onCommit: (index: number) => void
  onPreview: (index: number | null) => void
  onBlocked: (index: number) => void
  children: ReactNode
}

export function MainTabPager({ index, reduceMotion, signedIn, onCommit, onPreview, onBlocked, children }: PagerProps) {
  const { width } = useWindowDimensions()
  const pages = useMemo(() => (Array.isArray(children) ? children : [children]), [children])
  const widthSV = useSharedValue(width)
  const offset = useSharedValue(0)
  const dragOrigin = useSharedValue(0)
  const touchX = useSharedValue(0)
  const touchY = useSharedValue(0)
  const dragging = useSharedValue(false)
  const activated = useSharedValue(false)
  const startIndex = useSharedValue(0)
  const preview = useSharedValue(index)
  const reduceSV = useSharedValue(reduceMotion)
  const signedInSV = useSharedValue(signedIn ? 1 : 0)
  const maskSV = useSharedValue(authBitmask())
  const mapRect = useSharedValue<TabSwipeRect | null>(null)
  const sheetRect = useSharedValue<TabSwipeRect | null>(null)
  const horizontalRects = useSharedValue<TabSwipeRect[]>([])
  const horizontalStore = useRef<Record<string, TabSwipeRect>>({})
  const measurers = useRef(new Map<string, () => void>())
  const placed = useRef(false)
  const commitRef = useRef(onCommit)
  const previewRef = useRef(onPreview)
  const blockedRef = useRef(onBlocked)
  commitRef.current = onCommit
  previewRef.current = onPreview
  blockedRef.current = onBlocked

  const commit = useCallback((next: number) => commitRef.current(next), [])
  const publishPreview = useCallback((next: number | null) => previewRef.current(next), [])
  const blocked = useCallback((next: number) => blockedRef.current(next), [])
  const remeasure = useCallback(() => {
    measurers.current.forEach((measure) => measure())
  }, [])

  const api = useMemo<Api>(() => ({
    report: (id, kind, rect) => {
      if (kind === 'map') {
        mapRect.value = rect
        return
      }
      if (kind === 'sheet') {
        sheetRect.value = rect
        return
      }
      if (rect) horizontalStore.current[id] = rect
      else delete horizontalStore.current[id]
      horizontalRects.value = Object.values(horizontalStore.current)
    },
    remeasureAll: () => {
      measurers.current.forEach((measure) => measure())
    },
    watch: (id, measure) => {
      measurers.current.set(id, measure)
      return () => {
        measurers.current.delete(id)
      }
    },
  }), [horizontalRects, mapRect, sheetRect])

  useEffect(() => {
    widthSV.value = width
    reduceSV.value = reduceMotion
    signedInSV.value = signedIn ? 1 : 0
    if (!(width > 0) || dragging.value) return
    const target = -clampTabIndex(index, TAB_COUNT) * width
    if (!placed.current || reduceMotion) {
      placed.current = true
      offset.value = target
      remeasure()
      return
    }
    offset.value = withSpring(target, PAGE_SPRING, (finished) => {
      if (finished) runOnJS(remeasure)()
    })
  }, [dragging, index, offset, reduceMotion, reduceSV, remeasure, signedIn, signedInSV, width, widthSV])

  const pan = useMemo(() => Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((event, manager) => {
      'worklet'
      const touch = event.allTouches[0]
      const pageWidth = widthSV.value
      if (!touch || !(pageWidth > 0)) {
        manager.fail()
        return
      }
      touchX.value = touch.absoluteX
      touchY.value = touch.absoluteY
      const page = clampTabIndex(Math.round(-offset.value / pageWidth), TAB_COUNT)
      const start = tabSwipeStartFromPoint({
        x: touch.absoluteX,
        y: touch.absoluteY,
        width: pageWidth,
        ridesMapTab: page === 0,
        map: mapRect.value,
        sheet: sheetRect.value,
        horizontal: horizontalRects.value,
      })
      if (!tabSwipeAllowed(start)) manager.fail()
    })
    .onTouchesMove((event, manager) => {
      'worklet'
      if (activated.value) return
      const touch = event.allTouches[0]
      if (!touch) return
      const dx = touch.absoluteX - touchX.value
      const dy = touch.absoluteY - touchY.value
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) manager.fail()
      else if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)) manager.activate()
    })
    .onTouchesUp((_event, manager) => {
      'worklet'
      if (!activated.value) manager.fail()
    })
    .onTouchesCancelled((_event, manager) => {
      'worklet'
      if (!activated.value) manager.fail()
    })
    .onStart(() => {
      'worklet'
      activated.value = true
      dragging.value = true
      dragOrigin.value = offset.value
      const pageWidth = widthSV.value
      startIndex.value = pageWidth > 0 ? clampTabIndex(Math.round(-offset.value / pageWidth), TAB_COUNT) : 0
    })
    .onUpdate((event) => {
      'worklet'
      const pageWidth = widthSV.value
      if (!(pageWidth > 0) || reduceSV.value) return
      let min = -(TAB_COUNT - 1) * pageWidth
      let max = 0
      if (!signedInSV.value) {
        const origin = -startIndex.value * pageWidth
        min = origin
        max = origin
        const next = startIndex.value + 1
        const prev = startIndex.value - 1
        if (next < TAB_COUNT && !pageBlocked(next, maskSV.value, signedInSV.value)) min = -next * pageWidth
        if (prev >= 0 && !pageBlocked(prev, maskSV.value, signedInSV.value)) max = -prev * pageWidth
      }
      offset.value = resist(dragOrigin.value + event.translationX, min, max)
      const shown = clampTabIndex(Math.round(-offset.value / pageWidth), TAB_COUNT)
      const visible = pageBlocked(shown, maskSV.value, signedInSV.value) ? startIndex.value : shown
      if (visible !== preview.value) {
        preview.value = visible
        runOnJS(publishPreview)(visible)
      }
    })
    .onEnd((event) => {
      'worklet'
      const pageWidth = widthSV.value
      const from = startIndex.value
      const direction = swipeDirection(event.translationX, event.velocityX, pageWidth)
      const attempted = applyTabNavigation(from, { type: 'swipe', direction }, TAB_COUNT)
      const next = pageBlocked(attempted, maskSV.value, signedInSV.value) ? from : attempted
      const target = pageWidth > 0 ? -next * pageWidth : 0
      if (reduceSV.value) {
        offset.value = target
        runOnJS(remeasure)()
      } else {
        offset.value = withSpring(target, PAGE_SPRING, (finished) => {
          if (finished) runOnJS(remeasure)()
        })
      }
      preview.value = next
      if (next !== attempted) runOnJS(blocked)(attempted)
      if (next !== from) runOnJS(commit)(next)
      else runOnJS(publishPreview)(null)
    })
    .onFinalize(() => {
      'worklet'
      activated.value = false
      dragging.value = false
    }), [activated, blocked, commit, dragOrigin, dragging, horizontalRects, mapRect, maskSV, offset, preview, publishPreview, reduceSV, remeasure, sheetRect, signedInSV, startIndex, touchX, touchY, widthSV])

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }))

  return (
    <TabSwipeContext.Provider value={api}>
      <View style={styles.viewport}>
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.track, { width: Math.max(width, 1) * TAB_COUNT }, animatedStyle]}>
            {pages.map((page, pageIndex) => (
              <View
                key={RIDER_MAIN_TABS[pageIndex]?.id ?? pageIndex}
                style={{ width: Math.max(width, 1) }}
                accessibilityElementsHidden={pageIndex !== index}
                importantForAccessibility={pageIndex !== index ? 'no-hide-descendants' : 'auto'}
              >
                {page}
              </View>
            ))}
          </Animated.View>
        </GestureDetector>
      </View>
    </TabSwipeContext.Provider>
  )
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  track: { flexDirection: 'row', height: '100%' },
})
