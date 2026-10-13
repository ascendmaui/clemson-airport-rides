import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWindowDimensions, type LayoutChangeEvent } from 'react-native'
import { Gesture } from 'react-native-gesture-handler'
import {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { tapHaptic } from '@/lib/feedback'
import {
  HOME_SHEET_BOTTOM_PADDING,
  HOME_SHEET_HANDLE_FALLBACK,
  HOME_SHEET_SEARCH_FALLBACK,
  HOME_SHEET_SPRING,
  buildHomeSheetSnapPoints,
  homeTabClearance,
  indexOfSnap,
  snapHomeSheet,
  type HomeSheetDetent,
} from '@/lib/homeSheetSnap'

function estimateTabBar(bottomInset: number) {
  return homeTabClearance(bottomInset)
}

/**
 * Home sheet drag. The finger follows on the UI thread; release springs to a
 * snap point. The sheet is a flex sibling of the map, so a collapsed sheet
 * leaves the map free to receive touches.
 */
export function useHomeSheetSnap(onFocusSearch: () => void, extraCollapsed = 0) {
  const { height: windowH } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [tabH, setTabH] = useState(() => estimateTabBar(insets.bottom))
  const [searchH, setSearchH] = useState(HOME_SHEET_SEARCH_FALLBACK)
  const [handleH, setHandleH] = useState(HOME_SHEET_HANDLE_FALLBACK)
  const [detent, setDetent] = useState<HomeSheetDetent>('expanded')

  const extra = Number.isFinite(extraCollapsed) ? Math.max(0, extraCollapsed) : 0
  const points = buildHomeSheetSnapPoints({
    windowHeight: windowH,
    tabBarHeight: tabH,
    searchFieldHeight: searchH,
    handleHeight: handleH,
    bottomPadding: HOME_SHEET_BOTTOM_PADDING + extra,
  })
  const initialIndex = Math.max(0, points.length - 1)
  const snapPoints = useSharedValue(points)
  const sheetH = useSharedValue(points[initialIndex] ?? HOME_SHEET_SEARCH_FALLBACK)
  const dragOrigin = useSharedValue(sheetH.value)
  const dragging = useSharedValue(false)
  const touched = useSharedValue(false)
  const restingIndex = useSharedValue(initialIndex)
  const focusRef = useRef(onFocusSearch)
  focusRef.current = onFocusSearch
  const pendingFocus = useRef(false)

  const commitSnap = useCallback((next: HomeSheetDetent) => {
    setDetent(next)
    void tapHaptic()
  }, [])

  const expandFromSearch = useCallback(() => {
    const nextPoints = snapPoints.value
    if (nextPoints.length === 0) return
    const index = nextPoints.length - 1
    if (restingIndex.value === index) {
      focusRef.current()
      return
    }
    touched.value = true
    restingIndex.value = index
    dragOrigin.value = nextPoints[index]
    cancelAnimation(sheetH)
    sheetH.value = withSpring(nextPoints[index], HOME_SHEET_SPRING)
    pendingFocus.current = true
    commitSnap('expanded')
  }, [commitSnap, dragOrigin, restingIndex, sheetH, snapPoints, touched])

  const nudge = useCallback((direction: -1 | 1) => {
    const nextPoints = snapPoints.value
    if (nextPoints.length === 0) return
    const index = Math.min(nextPoints.length - 1, Math.max(0, restingIndex.value + direction))
    if (index === restingIndex.value) return
    touched.value = true
    restingIndex.value = index
    dragOrigin.value = nextPoints[index]
    cancelAnimation(sheetH)
    sheetH.value = withSpring(nextPoints[index], HOME_SHEET_SPRING)
    commitSnap(index === 0 ? 'collapsed' : 'expanded')
  }, [commitSnap, dragOrigin, restingIndex, sheetH, snapPoints, touched])

  useEffect(() => {
    const nextPoints = buildHomeSheetSnapPoints({
      windowHeight: windowH,
      tabBarHeight: tabH,
      searchFieldHeight: searchH,
      handleHeight: handleH,
      bottomPadding: HOME_SHEET_BOTTOM_PADDING + extra,
    })
    snapPoints.value = nextPoints
    if (dragging.value || nextPoints.length === 0) return
    // Stay on the open sheet until the rider actually drags, so a late tab
    // measurement cannot leave the first frame collapsed.
    const index = touched.value
      ? Math.min(Math.max(0, restingIndex.value), nextPoints.length - 1)
      : nextPoints.length - 1
    restingIndex.value = index
    const target = nextPoints[index]
    if (Math.abs(sheetH.value - target) < 0.5) return
    dragOrigin.value = target
    sheetH.value = touched.value ? withSpring(target, HOME_SHEET_SPRING) : target
  }, [extra, windowH, tabH, searchH, handleH, dragOrigin, dragging, restingIndex, sheetH, snapPoints, touched])

  useEffect(() => {
    if (!pendingFocus.current || detent !== 'expanded') return
    pendingFocus.current = false
    focusRef.current()
  }, [detent])

  const gestures = useMemo(() => {
    const beginDrag = () => {
      'worklet'
      cancelAnimation(sheetH)
      dragOrigin.value = sheetH.value
      dragging.value = true
      touched.value = true
    }
    const moveDrag = (translationY: number) => {
      'worklet'
      const current = snapPoints.value
      if (current.length === 0) return
      const min = current[0]
      const max = current[current.length - 1]
      const next = dragOrigin.value - translationY
      sheetH.value = Math.min(max, Math.max(min, next))
    }
    const endDrag = (velocityY: number) => {
      'worklet'
      dragging.value = false
      const current = snapPoints.value
      const next = snapHomeSheet({
        position: sheetH.value,
        velocity: velocityY,
        snapPoints: current,
      })
      const index = indexOfSnap(current, next.height)
      const changed = index !== restingIndex.value
      restingIndex.value = index
      touched.value = true
      dragOrigin.value = next.height
      sheetH.value = withSpring(next.height, HOME_SHEET_SPRING)
      if (changed) runOnJS(commitSnap)(next.detent)
    }
    const handlePan = Gesture.Pan()
      .activeOffsetY([-6, 6])
      .failOffsetX([-16, 16])
      .onStart(beginDrag)
      .onUpdate((event) => {
        moveDrag(event.translationY)
      })
      .onEnd((event) => {
        endDrag(event.velocityY)
      })
      .onFinalize(() => {
        dragging.value = false
      })
    const searchPan = Gesture.Pan()
      .activeOffsetY([-8, 8])
      .failOffsetX([-20, 20])
      .onStart(beginDrag)
      .onUpdate((event) => {
        moveDrag(event.translationY)
      })
      .onEnd((event) => {
        endDrag(event.velocityY)
      })
      .onFinalize(() => {
        dragging.value = false
      })
    const searchTap = Gesture.Tap()
      .maxDistance(14)
      .onEnd((_event, success) => {
        if (success) runOnJS(expandFromSearch)()
      })
    return {
      handlePan,
      searchGesture: Gesture.Exclusive(searchPan, searchTap),
    }
  }, [commitSnap, dragOrigin, dragging, expandFromSearch, restingIndex, sheetH, snapPoints, touched])

  const sheetStyle = useAnimatedStyle(() => ({
    height: sheetH.value,
  }))

  const hintStyle = useAnimatedStyle(() => {
    const current = snapPoints.value
    const collapsed = current[0] ?? 0
    const open = current.length > 1 ? current[1] : collapsed + 1
    const span = Math.max(1, open - collapsed)
    const shown = Math.min(1, Math.max(0, (sheetH.value - collapsed) / span))
    return {
      height: 24 * shown,
      opacity: shown,
      overflow: 'hidden' as const,
    }
  })

  const onHandleLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height)
    setHandleH((current) => (next > 0 && next !== current ? next : current))
  }, [])

  const onSearchLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height)
    setSearchH((current) => (next > 0 && next !== current ? next : current))
  }, [])

  const onTabLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height)
    setTabH((current) => (next > 0 && next !== current ? next : current))
  }, [])

  return {
    detent,
    scrollEnabled: detent !== 'collapsed',
    sheetStyle,
    hintStyle,
    handlePan: gestures.handlePan,
    searchGesture: gestures.searchGesture,
    expandFromSearch,
    nudge,
    onHandleLayout,
    onSearchLayout,
    onTabLayout,
  }
}
