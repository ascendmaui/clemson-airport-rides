import { useMemo, useRef, useState } from 'react'
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
  const x = useRef(new Animated.Value(0)).current
  const trackRef = useRef(0)
  const disabledRef = useRef(Boolean(disabled))
  disabledRef.current = Boolean(disabled)
  const confirmRef = useRef(onConfirm)
  confirmRef.current = onConfirm

  const reset = () => Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 6 }).start()

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabledRef.current,
    onMoveShouldSetPanResponder: (_e, g) => !disabledRef.current && Math.abs(g.dx) > 4,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_e, g) => x.setValue(swipeOffset(g.dx, trackRef.current, KNOB)),
    onPanResponderRelease: (_e, g) => {
      if (!disabledRef.current && swipeConfirms(g.dx, trackRef.current, KNOB)) {
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
    setTrack(event.nativeEvent.layout.width)
  }

  const fill = x.interpolate({ inputRange: [0, Math.max(1, track - KNOB)], outputRange: [KNOB, Math.max(KNOB, track)], extrapolate: 'clamp' })

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
      <Animated.View style={[styles.fill, { width: fill, backgroundColor: colors.fill }]} />
      <Text style={[styles.label, { color: colors.title }]} numberOfLines={1}>{label}</Text>
      <Animated.View
        {...responder.panHandlers}
        style={[styles.knob, { backgroundColor: colors.orange, transform: [{ translateX: x }] }]}
      >
        <Text style={[styles.arrow, { color: colors.onAccent }]}>→</Text>
      </Animated.View>
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
