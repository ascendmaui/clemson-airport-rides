import { Glyph, SPRING } from 'rides-native/icons'
import { useCallback, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { swipeConfirms } from 'rides-native/swipeConfirm'
import { useMemo, useRef, useState } from 'react'
import * as Haptics from 'expo-haptics'
import { Animated, PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { swipeConfirms, swipeOffset } from 'rides-native/swipeConfirm'
import { useTheme } from '@/lib/theme'

const KNOB = 56

/**
 * Swipe the knob to the end to confirm. A tap does nothing, so a pocket or
 * accidental touch cannot start the trip. VoiceOver/TalkBack users get an
 * "activate" action with the same effect.
 */
export function SwipeToStart({
  label,
  a11yLabel,
  disabled,
  onConfirm,
}: {
  label: string
  a11yLabel: string
  disabled?: boolean
  onConfirm: () => void
}) {
  const { colors } = useTheme()
  const [track, setTrack] = useState(0)
  // Knob position lives on the UI thread; the pan never round-trips through React state.
  const x = useSharedValue(0)
  const max = useSharedValue(0)
  const trackRef = useRef(0)
  const disabledRef = useRef(Boolean(disabled))
  disabledRef.current = Boolean(disabled)
  const confirmRef = useRef(onConfirm)
  confirmRef.current = onConfirm

  const finish = useCallback((dx: number) => {
    const g = { dx }
    if (!disabledRef.current && swipeConfirms(g.dx, trackRef.current, KNOB)) {
      x.value = withTiming(Math.max(0, trackRef.current - KNOB), { duration: 120 }, (done) => {
        if (done) runOnJS(confirmAndReset)()
      })
    } else {
      x.value = withSpring(0, SPRING)
    }
  }, [x])

  function confirmAndReset() {
    confirmRef.current()
    x.value = withSpring(0, SPRING)
  }

  const pan = useMemo(() => Gesture.Pan()
    .enabled(!disabled)
    .activeOffsetX([-4, 4])
    .onUpdate((e) => {
      x.value = Math.min(Math.max(0, e.translationX), max.value)
    })
    .onEnd((e) => {
      runOnJS(finish)(e.translationX)
    })
    .onFinalize((_e, success) => {
      if (!success) x.value = withSpring(0, SPRING)
    }), [disabled, finish, max, x])
  const armedRef = useRef(false)
  const reset = () => {
    armedRef.current = false
    Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 6 }).start()
  }

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabledRef.current,
    onMoveShouldSetPanResponder: (_e, g) => !disabledRef.current && Math.abs(g.dx) > 4,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      Haptics.selectionAsync().catch(() => {})
    },
    onPanResponderMove: (_e, g) => {
      x.setValue(swipeOffset(g.dx, trackRef.current, KNOB))
      // One tick when the knob crosses the confirm point, so the driver feels it without looking.
      const armed = swipeConfirms(g.dx, trackRef.current, KNOB)
      if (armed && !armedRef.current) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
      armedRef.current = armed
    },
    onPanResponderRelease: (_e, g) => {
      if (!disabledRef.current && swipeConfirms(g.dx, trackRef.current, KNOB)) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        Animated.timing(x, { toValue: Math.max(0, trackRef.current - KNOB), duration: 120, useNativeDriver: false }).start(() => {
          confirmRef.current()
          reset()
        })
      } else {
        reset()
      }
    },
    onPanResponderTerminate: reset,
  }), [x])

  function onLayout(event: LayoutChangeEvent) {
    trackRef.current = event.nativeEvent.layout.width
    max.value = Math.max(0, event.nativeEvent.layout.width - KNOB - 8)
    setTrack(event.nativeEvent.layout.width)
  }

  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))
  const fillStyle = useAnimatedStyle(() => ({
    width: interpolate(x.value, [0, Math.max(1, track - KNOB)], [KNOB, Math.max(KNOB, track)], Extrapolation.CLAMP),
  }))

  return (
    <View
      onLayout={onLayout}
      style={[styles.track, { backgroundColor: colors.track, opacity: disabled ? 0.6 : 1 }]}
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
      <Animated.View style={[styles.fill, { backgroundColor: colors.fill }, fillStyle]} />
      <Text style={[styles.label, { color: colors.title }]} numberOfLines={1}>{label}</Text>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.knob, { backgroundColor: colors.orange }, knobStyle]}>
          <Glyph name="forward" size={22} color={colors.onAccent} />
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

const styles = StyleSheet.create({
  track: { height: KNOB + 8, borderRadius: (KNOB + 8) / 2, justifyContent: 'center', padding: 4, overflow: 'hidden' },
  fill: { position: 'absolute', left: 4, top: 4, bottom: 4, borderRadius: KNOB / 2 },
  label: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontWeight: '800', fontSize: 16 },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, alignItems: 'center', justifyContent: 'center' },
  arrow: { fontSize: 24, fontWeight: '900' },
})
