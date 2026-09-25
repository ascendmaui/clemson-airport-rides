import { useEffect, useRef } from 'react'
import { Animated, Platform, StyleSheet, Text, View } from 'react-native'
import { FullWindowOverlay } from 'react-native-screens'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { approachHaptic } from '@/lib/feedback'
import { formatApproachFeet } from '@/lib/approachAlert'
import { useSosEngaged } from '@/lib/sosEngaged'
import { useDriverApproach } from '@/lib/useDriverApproach'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

const STAGE_HAPTIC_GAP_MS = 12000

export function ApproachAlert({
  status,
  driverId,
}: {
  status: string | null
  driverId: string | null
}) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const paused = useSosEngaged()
  const { active, reading, attention, statusLine, waiting } = useDriverApproach(status, driverId)
  const wash = useRef(new Animated.Value(0)).current
  const bright = useRef(new Animated.Value(0)).current
  const lastStageHaptic = useRef<string | null>(null)
  const lastClosingHaptic = useRef(0)
  const pulseMode = attention?.pulseMode ?? 'off'
  const washPeak = attention?.washPeak ?? 0
  const brightPeak = attention?.brightPeak ?? 0
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
      void approachHaptic(haptic)
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
    let loop: Animated.CompositeAnimation | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const fade = () => {
      loop?.stop()
      Animated.timing(wash, { toValue: 0, duration: 480, useNativeDriver: true }).start()
      Animated.timing(bright, { toValue: 0, duration: 480, useNativeDriver: true }).start()
    }
    if (!active || paused || pulseMode === 'off') {
      if (paused) {
        wash.stopAnimation()
        bright.stopAnimation()
        wash.setValue(0)
        bright.setValue(0)
      } else {
        fade()
      }
      return () => {
        loop?.stop()
      }
    }
    const half = stage === 'here' ? 820 : 980
    wash.setValue(0.04)
    bright.setValue(0)
    loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(wash, { toValue: washPeak, duration: half, useNativeDriver: true }),
          Animated.timing(bright, { toValue: brightPeak, duration: half, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(wash, { toValue: 0.04, duration: half, useNativeDriver: true }),
          Animated.timing(bright, { toValue: 0, duration: half, useNativeDriver: true }),
        ]),
      ]),
    )
    loop.start()
    if (pulseMode === 'burst') timer = setTimeout(fade, half * 6)
    return () => {
      if (timer) clearTimeout(timer)
      loop?.stop()
    }
  }, [active, bright, brightPeak, paused, pulseMode, stage, wash, washPeak])

  if (!active || paused) return null

  const primary = approachPrimaryLine(reading?.feet)
  const kicker = statusLine.split(' · ')[0]
  const secondary = reading?.secondary ?? waiting ?? statusLine

  const body = (
    <View pointerEvents="box-none" style={styles.host}>
      <Animated.View pointerEvents="none" style={[styles.wash, { backgroundColor: colors.orange, opacity: wash }]} />
      <Animated.View pointerEvents="none" style={[styles.wash, { backgroundColor: colors.orangeBright, opacity: bright }]} />
      <View pointerEvents="none" style={[styles.dock, { bottom: Math.max(insets.bottom, 10) + 74 }]}>
        <View
          accessible
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          accessibilityLabel={reading ? `${primary}, ${reading.secondary}. ${statusLine}` : `${primary}. ${waiting ?? statusLine}`}
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

function approachPrimaryLine(feet: number | null | undefined): string {
  const label = formatApproachFeet(feet)
  return label === 'nearby' ? 'Nearby' : label
}

function makeStyles(colors: Palette) {
  return {
    host: {
      ...StyleSheet.absoluteFill,
      zIndex: 40,
      elevation: 40,
    },
    wash: {
      ...StyleSheet.absoluteFill,
    },
    dock: {
      position: 'absolute' as const,
      left: 16,
      right: 16,
    },
    card: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 12,
      backgroundColor: colors.card,
      borderRadius: 22,
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    dot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.orange,
    },
    copy: { flex: 1 },
    kicker: {
      color: colors.orange,
      fontSize: 11,
      fontWeight: '800' as const,
      letterSpacing: 1.1,
    },
    primary: {
      color: colors.title,
      fontSize: 22,
      fontWeight: '800' as const,
      letterSpacing: -0.3,
      marginTop: 2,
    },
    secondary: {
      color: colors.inkSecondary,
      fontSize: 13,
      fontWeight: '600' as const,
      marginTop: 2,
    },
  }
}
