import { useEffect, useRef } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { FullWindowOverlay } from 'react-native-screens'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { approachHaptic, arrivalCue, playApproachPing } from '@/lib/feedback'
import {
  approachPulseMotion,
  crowdCue,
  type ApproachPulseEasing,
  type ApproachPulseMode,
} from '@/lib/approachAlert'
import { useSosEngaged } from '@/lib/sosEngaged'
import { useDriverApproach } from '@/lib/useDriverApproach'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

const STAGE_HAPTIC_GAP_MS = 12000

const glowStyles = StyleSheet.create({
  halo: {
    position: 'absolute',
  },
  haloOuter: {
    top: -18,
    left: -18,
    right: -18,
    bottom: -18,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  haloInner: {
    top: -8,
    left: -8,
    right: -8,
    bottom: -8,
  },
})

function pulseEasing(easing: ApproachPulseEasing) {
  switch (easing) {
    case 'inOutSin':
      return Easing.inOut(Easing.sin)
    default: {
      const neverEasing: never = easing
      return neverEasing
    }
  }
}

function breathe(
  value: SharedValue<number>,
  from: number,
  to: number,
  durationMs: number,
  easing: ApproachPulseEasing,
) {
  const timing = { duration: durationMs, easing: pulseEasing(easing) }
  value.value = withRepeat(
    withSequence(
      withTiming(to, timing),
      withTiming(from, timing),
    ),
    -1,
    false,
  )
}

/**
 * Soft orange-to-purple glow around the driver card.
 * Opacity and scale run on the UI thread. Reduce motion holds the rest keyframe.
 */
function ApproachGlow({
  round,
  orange,
  purple,
  reduceMotion,
  pulseMode,
}: {
  round: boolean
  orange: string
  purple: string
  reduceMotion: boolean
  pulseMode: Exclude<ApproachPulseMode, 'off'>
}) {
  const motion = approachPulseMotion(reduceMotion)
  const orangeOpacity = useSharedValue(motion.rest.opacity)
  const purpleOpacity = useSharedValue(motion.enabled ? motion.peak.opacity : motion.rest.opacity)
  const scale = useSharedValue(motion.rest.scale)

  useEffect(() => {
    const next = approachPulseMotion(reduceMotion)
    cancelAnimation(orangeOpacity)
    cancelAnimation(purpleOpacity)
    cancelAnimation(scale)
    if (!next.enabled) {
      orangeOpacity.value = next.rest.opacity
      purpleOpacity.value = next.rest.opacity
      scale.value = next.rest.scale
      return undefined
    }
    const timing = { duration: next.durationMs, easing: pulseEasing(next.easing) }
    breathe(orangeOpacity, next.rest.opacity, next.peak.opacity, next.durationMs, next.easing)
    breathe(purpleOpacity, next.peak.opacity, next.rest.opacity, next.durationMs, next.easing)
    breathe(scale, next.rest.scale, next.peak.scale, next.durationMs, next.easing)
    let timer: ReturnType<typeof setTimeout> | undefined
    switch (pulseMode) {
      case 'burst':
        timer = setTimeout(() => {
          cancelAnimation(orangeOpacity)
          cancelAnimation(purpleOpacity)
          cancelAnimation(scale)
          orangeOpacity.value = withTiming(next.rest.opacity, timing)
          purpleOpacity.value = withTiming(next.rest.opacity, timing)
          scale.value = withTiming(next.rest.scale, timing)
        }, next.durationMs * 6)
        break
      case 'steady':
        break
      default: {
        const neverMode: never = pulseMode
        return neverMode
      }
    }
    return () => {
      if (timer) clearTimeout(timer)
      cancelAnimation(orangeOpacity)
      cancelAnimation(purpleOpacity)
      cancelAnimation(scale)
    }
  }, [orangeOpacity, purpleOpacity, pulseMode, reduceMotion, scale])

  const orangeStyle = useAnimatedStyle(() => ({
    opacity: orangeOpacity.value,
    transform: [{ scale: scale.value }],
  }))
  const purpleStyle = useAnimatedStyle(() => ({
    opacity: purpleOpacity.value,
    transform: [{ scale: scale.value }],
  }))

  const outerRadius = round ? 108 : 36
  const innerRadius = round ? 96 : 28
  return (
    <>
      <Animated.View
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no"
        style={[
          glowStyles.halo,
          glowStyles.haloOuter,
          { borderRadius: outerRadius, backgroundColor: orange, shadowColor: orange },
          orangeStyle,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no"
        style={[
          glowStyles.halo,
          glowStyles.haloInner,
          { borderRadius: innerRadius, backgroundColor: purple },
          purpleStyle,
        ]}
      />
    </>
  )
}

export function ApproachAlert({
  status,
  driverId,
  tripId = null,
}: {
  status: string | null
  driverId: string | null
  tripId?: string | null
}) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const paused = useSosEngaged()
  const reduceMotion = useReducedMotion() === true
  const { active, reading, attention, statusLine, waiting } = useDriverApproach(status, driverId, tripId)
  const cue = crowdCue(reading?.feet)
  // Latest cue for the crowd loop. GPS updates change the distance every second or so;
  // the loop reads this ref instead of restarting, so a new fix can never fire an extra buzz.
  const cueRef = useRef(cue)
  cueRef.current = cue
  const lastSpike = useRef(0)
  const inCrowd = Boolean(cue)
  const lastStageHaptic = useRef<string | null>(null)
  const lastClosingHaptic = useRef(0)
  const pulseMode = attention?.pulseMode ?? 'off'
  const stage = attention?.stage ?? null
  const haptic = attention?.haptic ?? null
  const hapticReason = attention?.hapticReason ?? null

  useEffect(() => {
    if (!active || paused) return
    if (stage === 'far' || stage == null) lastStageHaptic.current = null
    else if (hapticReason !== 'stage') lastStageHaptic.current = null
    if (!haptic) return
    if (hapticReason === 'stage') {
      if (lastStageHaptic.current === stage) return
      lastStageHaptic.current = stage
      // Arrival gets one stronger cue instead of the plain stage buzz.
      if (stage === 'here') {
        lastClosingHaptic.current = Date.now()
        lastSpike.current = Date.now()
        void arrivalCue()
      } else {
        void approachHaptic(haptic)
      }
      return
    }
    if (hapticReason === 'closing') {
      const now = Date.now()
      if (now - lastClosingHaptic.current < STAGE_HAPTIC_GAP_MS) return
      lastClosingHaptic.current = now
      void approachHaptic(haptic)
    }
  }, [active, haptic, hapticReason, paused, stage])

  useEffect(() => {
    if (!active || paused || !inCrowd) return undefined
    let alive = true
    const tick = () => {
      const current = cueRef.current
      if (!alive || !current) return
      const now = Date.now()
      if (now - lastSpike.current < current.intervalMs) return
      lastSpike.current = now
      void approachHaptic(current.haptic)
      void playApproachPing()
    }
    tick()
    const timer = setInterval(tick, 250)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [active, inCrowd, paused])

  // The compass distance bubble (feet, heading, meters) is retired.
  // PickupBeaconHost is the close-range screen. This card only covers a missing fix.
  if (!active || paused || reading) return null

  const primary = waiting || "Waiting for your driver's location"
  const kicker = statusLine.split(' · ')[0]
  const secondary = statusLine && statusLine !== primary ? statusLine : ''
  const body = (
    <View pointerEvents="box-none" style={styles.host}>
      <View pointerEvents="none" style={[styles.dock, { bottom: Math.max(insets.bottom, 10) + 74 }]}>
        <View style={[styles.glowFrame, styles.glowFrameCard]}>
          {pulseMode === 'off' ? null : (
            <ApproachGlow
              round={false}
              orange={colors.orange}
              purple={colors.purple}
              reduceMotion={reduceMotion}
              pulseMode={pulseMode}
            />
          )}
          <View
            accessible
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${primary}. ${waiting ?? statusLine}`}
            style={[styles.card, lift(colors, 'float')]}
          >
            <View style={styles.dot} />
            <View style={styles.copy}>
              <Text style={styles.kicker}>{kicker.toUpperCase()}</Text>
              <Text style={styles.primary}>{primary}</Text>
              <Text style={styles.secondary}>{secondary}</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  )

  if (Platform.OS === 'ios') {
    return (
      <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>
        {body}
      </FullWindowOverlay>
    )
  }
  return body
}

function makeStyles(colors: Palette) {
  const accentText = colors.orangeInk
  return {
    host: {
      ...StyleSheet.absoluteFill,
      zIndex: 40,
      elevation: 40,
    },
    dock: {
      position: 'absolute' as const,
      left: 16,
      right: 16,
    },
    glowFrame: {
      position: 'relative' as const,
    },
    glowFrameCard: {
      alignSelf: 'stretch' as const,
    },
    card: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 12,
      backgroundColor: colors.card,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 16,
      paddingHorizontal: 16,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.orange,
    },
    copy: { flex: 1 },
    kicker: {
      color: accentText,
      fontSize: 12,
      fontWeight: '700' as const,
      letterSpacing: 0.8,
    },
    primary: {
      color: colors.title,
      fontSize: 22,
      fontWeight: '700' as const,
      letterSpacing: -0.4,
      marginTop: 2,
    },
    secondary: {
      color: colors.inkSecondary,
      fontSize: 13,
      fontWeight: '500' as const,
      lineHeight: 18,
      marginTop: 2,
    },
  }
}
