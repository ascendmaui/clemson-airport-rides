import { useEffect, useMemo, useRef } from 'react'
import * as Haptics from 'expo-haptics'
import { useNavigation } from 'expo-router'
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { GlassSheen, glassFill, glassRecipe, glassTextColor } from 'rides-native/glass'
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler'
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import {
  SWIPE_ACTIVE_OFFSET_X,
  SWIPE_FAIL_OFFSET_Y,
  createSwipeController,
  type SwipeCue,
} from 'rides-native/swipeConfirm'
import { useTheme } from '@/lib/theme'

const KNOB = 56
const KNOB_SPRING = { damping: 18, stiffness: 240, mass: 0.7 }

type ScreenGesture = {
  setOptions?: (options: { gestureEnabled?: boolean; fullScreenGestureEnabled?: boolean }) => void
}

function screenNavigation(navigation: unknown): ScreenGesture {
  if (navigation && typeof navigation === 'object' && 'setOptions' in navigation) return navigation as ScreenGesture
  return {}
}

/**
 * Swipe the knob to the end to confirm. A tap does nothing, so a pocket or
 * accidental touch cannot start the trip. VoiceOver/TalkBack users get an
 * "activate" action with the same effect.
 *
 * The pan is a gesture-handler gesture. PR #472 turned on the native stack's
 * full-screen back swipe and left this control on PanResponder, which never
 * joins that gesture arena, so the screen or the sheet scroll took the drag
 * and the start callback never ran. The screen gesture stays off while this
 * control is mounted (the knob sits in the back-swipe zone), and the parent
 * scroll is blocked only while the horizontal pan is active. Crossing the
 * threshold calls onConfirm once from the release path, with a success haptic.
 * A short swipe springs back.
 */
export function SwipeToStart({
  label,
  a11yLabel,
  disabled,
  onConfirm,
  onSwipeActive,
  blockGesture,
}: {
  label: string
  a11yLabel: string
  disabled?: boolean
  onConfirm: () => void
  /** Parent scroll lock. True only while the horizontal pan is active. */
  onSwipeActive?: (active: boolean) => void
  /** Parent native scroll gesture this pan blocks while it is recognizing. */
  blockGesture?: GestureType
}) {
  const { scheme } = useTheme()
  const trackRecipe = glassRecipe({ app: 'driver', scheme, variant: 'chip' })
  const knobRecipe = glassRecipe({ app: 'driver', scheme, variant: 'fab', accent: 'orange' })
  const labelColor = glassTextColor({ app: 'driver', scheme, variant: 'chip' })
  const navigation = useNavigation()
  const x = useSharedValue(0)
  const trackWidthSv = useSharedValue(0)
  const trackRef = useRef(0)
  const disabledRef = useRef(Boolean(disabled))
  disabledRef.current = Boolean(disabled)
  const confirmRef = useRef(onConfirm)
  confirmRef.current = onConfirm
  const activeRef = useRef(onSwipeActive)
  activeRef.current = onSwipeActive
  const endedRef = useRef(false)
  const cueRef = useRef<(cue: SwipeCue) => void>(() => {})

  const controller = useRef(createSwipeController({
    knobWidth: KNOB,
    getTrackWidth: () => trackRef.current,
    isDisabled: () => disabledRef.current,
    onAccept: () => confirmRef.current(),
    onCue: (cue) => cueRef.current(cue),
  })).current

  cueRef.current = (cue) => {
    switch (cue) {
      case 'threshold':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
        return
      case 'success':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        return
      default: {
        const neverCue: never = cue
        return neverCue
      }
    }
  }

  useEffect(() => {
    // Off for the whole time the control is on screen. Turning it off only after
    // the pan activates is too late: the back gesture has already claimed the touch.
    const nav = screenNavigation(navigation)
    nav.setOptions?.({ gestureEnabled: false, fullScreenGestureEnabled: false })
    return () => {
      nav.setOptions?.({ gestureEnabled: true, fullScreenGestureEnabled: true })
      activeRef.current?.(false)
    }
  }, [navigation])

  const handlers = useRef({
    begin() {},
    start() {},
    move(_dx: number) {},
    end(_dx: number, _success: boolean) {},
    finalize(_dx: number, _success: boolean) {},
  })
  handlers.current.begin = () => {
    endedRef.current = false
    controller.begin()
    x.value = 0
    screenNavigation(navigation).setOptions?.({ gestureEnabled: false, fullScreenGestureEnabled: false })
    Haptics.selectionAsync().catch(() => {})
  }
  handlers.current.start = () => {
    activeRef.current?.(true)
  }
  handlers.current.move = (dx) => {
    x.value = controller.move(dx).offset
  }
  handlers.current.end = (dx, success) => {
    // A cancelled pan also emits onEnd, with success false. That must spring back, not accept.
    if (!success || endedRef.current) return
    endedRef.current = true
    const decision = controller.release(dx)
    x.value = withSpring(decision.offset, KNOB_SPRING)
  }
  handlers.current.finalize = (dx, success) => {
    // onEnd and onFinalize both run when the pan finishes. Release once.
    if (!endedRef.current) {
      if (success) {
        endedRef.current = true
        const decision = controller.release(dx)
        x.value = withSpring(decision.offset, KNOB_SPRING)
      } else {
        controller.cancel()
        x.value = withSpring(0, KNOB_SPRING)
      }
    }
    activeRef.current?.(false)
  }

  const pan = useMemo(() => {
    const gesture = Gesture.Pan()
      .runOnJS(true)
      .enabled(!disabled)
      .activeOffsetX(SWIPE_ACTIVE_OFFSET_X)
      .failOffsetY([-SWIPE_FAIL_OFFSET_Y, SWIPE_FAIL_OFFSET_Y])
      .onBegin(() => { handlers.current.begin() })
      .onStart(() => { handlers.current.start() })
      .onUpdate((event) => { handlers.current.move(event.translationX) })
      .onEnd((event, success) => { handlers.current.end(event.translationX, success) })
      .onFinalize((event, success) => { handlers.current.finalize(event.translationX, success) })
    // Block the sheet scroll (and any other native pan wired to this ref) so a
    // horizontal drag is not stolen. Vertical movement still fails the pan via failOffsetY.
    return blockGesture ? gesture.blocksExternalGesture(blockGesture) : gesture
  }, [blockGesture, disabled])

  function onLayout(event: LayoutChangeEvent) {
    const width = event.nativeEvent.layout.width
    trackRef.current = width
    trackWidthSv.value = width
  }

  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))
  const fillStyle = useAnimatedStyle(() => {
    const travel = Math.max(1, trackWidthSv.value - KNOB)
    return {
      width: interpolate(x.value, [0, travel], [KNOB, Math.max(KNOB, trackWidthSv.value)], Extrapolation.CLAMP),
    }
  })

  return (
    <GestureDetector gesture={pan}>
      <View
        collapsable={false}
        onLayout={onLayout}
        style={[styles.track, { backgroundColor: glassFill(trackRecipe), opacity: disabled ? 0.6 : 1 }]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={a11yLabel}
        accessibilityHint="Swipe right to confirm, or use the activate action."
        accessibilityState={{ disabled: Boolean(disabled) }}
        accessibilityActions={[{ name: 'activate', label: a11yLabel }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'activate' && !disabled) onConfirm()
        }}
      >
        <GlassSheen scheme={scheme} radius={(KNOB + 8) / 2} tint="#522D80" />
        <Animated.View style={[styles.fill, { backgroundColor: glassFill(knobRecipe) }, fillStyle]} />
        <Text style={[styles.label, { color: labelColor }]} numberOfLines={1}>{label}</Text>
        <Animated.View style={[styles.knob, { backgroundColor: glassFill(knobRecipe) }, knobStyle]}>
          <GlassSheen scheme={scheme} radius={KNOB / 2} tint="#F56600" />
          <Text style={[styles.arrow, { color: knobRecipe.text }]}>→</Text>
        </Animated.View>
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  track: { height: KNOB + 8, borderRadius: (KNOB + 8) / 2, justifyContent: 'center', padding: 4, overflow: 'hidden' },
  fill: { position: 'absolute', left: 4, top: 4, bottom: 4, borderRadius: KNOB / 2 },
  label: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontWeight: '800', fontSize: 16 },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  arrow: { fontSize: 24, fontWeight: '900' },
})
