import { useEffect } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { FullWindowOverlay } from 'react-native-screens'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import {
  PICKUP_BEACON_ORANGE,
  pickupBeaconPrompt,
  pickupBeaconPulse,
} from '../../shared/pickupBeacon.js'

const AWAKE_TAG = 'pickup-beacon'

function pulseEasing(easing) {
  if (easing === 'inOutSin') return Easing.inOut(Easing.sin)
  return Easing.inOut(Easing.sin)
}

/**
 * Full-screen pickup code. The plate is a solid fill, not glass.
 * The rider wash breathes between two opacities that stay above 0.
 */
export function PickupBeaconScreen({ role, code, onClose }) {
  const insets = useSafeAreaInsets()
  const reduceMotion = useReducedMotion() === true
  const prompt = pickupBeaconPrompt(role)
  const motion = pickupBeaconPulse(reduceMotion || role !== 'rider')
  const wash = useSharedValue(motion.rest.opacity)
  const scale = useSharedValue(motion.rest.scale)

  useEffect(() => {
    activateKeepAwakeAsync(AWAKE_TAG).catch(() => {})
    return () => {
      try {
        deactivateKeepAwake(AWAKE_TAG)
      } catch {
        /* The tag is already released when the beacon unmounts. */
      }
    }
  }, [])

  useEffect(() => {
    const next = pickupBeaconPulse(reduceMotion || role !== 'rider')
    cancelAnimation(wash)
    cancelAnimation(scale)
    if (!next.enabled) {
      wash.value = next.rest.opacity
      scale.value = next.rest.scale
      return undefined
    }
    const timing = { duration: next.durationMs, easing: pulseEasing(next.easing) }
    wash.value = withRepeat(
      withSequence(
        withTiming(next.peak.opacity, timing),
        withTiming(next.rest.opacity, timing),
      ),
      -1,
      false,
    )
    scale.value = withRepeat(
      withSequence(
        withTiming(next.peak.scale, timing),
        withTiming(next.rest.scale, timing),
      ),
      -1,
      false,
    )
    return () => {
      cancelAnimation(wash)
      cancelAnimation(scale)
    }
  }, [reduceMotion, role, scale, wash])

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: wash.value,
    transform: [{ scale: scale.value }],
  }))

  const spoken = String(code || '').split('').join(' ')
  const body = (
    <View
      accessibilityViewIsModal
      style={[styles.host, { backgroundColor: PICKUP_BEACON_ORANGE }]}
    >
      {role === 'rider' ? (
        <Animated.View pointerEvents="none" accessible={false} style={[styles.pulse, pulseStyle]} />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close pickup beacon"
        accessibilityHint="Turns off the pickup locator for this trip and returns to the live ride"
        onPress={onClose}
        hitSlop={12}
        style={[
          styles.close,
          { top: insets.top + 8, left: Math.max(insets.left, 8) },
        ]}
      >
        <Text style={styles.closeGlyph}>X</Text>
      </Pressable>
      <View style={styles.center} pointerEvents="none">
        <Text style={styles.prompt}>{prompt}</Text>
        <Text
          accessibilityRole="header"
          accessibilityLabel={`Pickup code ${spoken}`}
          style={styles.code}
        >
          {code}
        </Text>
      </View>
    </View>
  )

  if (Platform.OS === 'ios') {
    return (
      <FullWindowOverlay unstable_accessibilityContainerViewIsModal>
        {body}
      </FullWindowOverlay>
    )
  }
  return body
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFill,
    zIndex: 80,
    elevation: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFFFF',
  },
  close: {
    position: 'absolute',
    width: 64,
    height: 64,
    minWidth: 64,
    minHeight: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1008',
    zIndex: 2,
  },
  closeGlyph: {
    color: '#FFF8F2',
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 32,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingTop: 72,
  },
  prompt: {
    color: '#1A1008',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  code: {
    color: '#1A1008',
    fontSize: 112,
    lineHeight: 120,
    fontWeight: '800',
    letterSpacing: 8,
    textAlign: 'center',
    marginTop: 18,
    fontVariant: ['tabular-nums'],
  },
})
