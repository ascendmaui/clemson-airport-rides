import { useEffect, useRef } from 'react'
import { Animated, Platform, StyleSheet, Text, View } from 'react-native'
import { FullWindowOverlay } from 'react-native-screens'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { approachHaptic, arrivalCue, playApproachPing } from '@/lib/feedback'
import { crowdCue, formatApproachFeet } from '@/lib/approachAlert'
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
  const { active, reading, direction, attention, statusLine, waiting } = useDriverApproach(status, driverId, tripId)
  const wash = useRef(new Animated.Value(0)).current
  const bright = useRef(new Animated.Value(0)).current
  const flash = useRef(new Animated.Value(0)).current
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
    if (!active || paused || !inCrowd) {
      flash.stopAnimation()
      Animated.timing(flash, { toValue: 0, duration: 240, useNativeDriver: true }).start()
      return undefined
    }
    let alive = true
    const tick = () => {
      const current = cueRef.current
      if (!alive || !current) return
      const now = Date.now()
      if (now - lastSpike.current < current.intervalMs) return
      lastSpike.current = now
      void approachHaptic(current.haptic)
      void playApproachPing()
      flash.setValue(current.flash)
      Animated.timing(flash, {
        toValue: 0,
        duration: Math.min(420, Math.round(current.intervalMs * 0.45)),
        useNativeDriver: true,
      }).start()
    }
    tick()
    const timer = setInterval(tick, 250)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [active, flash, inCrowd, paused])

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const fade = () => {
      loop?.stop()
      Animated.timing(wash, { toValue: 0, duration: 260, useNativeDriver: true }).start()
      Animated.timing(bright, { toValue: 0, duration: 260, useNativeDriver: true }).start()
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
      <Animated.View pointerEvents="none" style={[styles.wash, { backgroundColor: colors.orange, opacity: flash }]} />
      <View pointerEvents="none" style={[styles.dock, { bottom: Math.max(insets.bottom, 10) + 74 }]}>
        <View
          accessible
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          accessibilityLabel={reading
            ? `${direction?.compass || 'Driver'} ${primary}. ${direction?.facing || reading.secondary}. ${statusLine}`
            : `${primary}. ${waiting ?? statusLine}`}
          style={reading ? [styles.bubble, lift(colors, 'float')] : [styles.card, lift(colors, 'float')]}
        >
          {reading ? (
            <>
              <View style={[styles.arrowWrap, { transform: [{ rotate: `${direction?.bearing ?? 0}deg` }] }]}>
                <Text style={styles.arrow}>▲</Text>
              </View>
              <Text style={styles.feet}>{formatApproachFeet(reading.feet)}</Text>
              <Text style={styles.compass}>{direction?.compass || 'Driver'}</Text>
              <Text style={styles.facing}>{direction?.facing || secondary}</Text>
            </>
          ) : (
            <>
              <View style={styles.dot} />
              <View style={styles.copy}>
                <Text style={styles.kicker}>{kicker.toUpperCase()}</Text>
                <Text style={styles.primary}>{primary}</Text>
                <Text style={styles.secondary}>{secondary}</Text>
              </View>
            </>
          )}
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
  const light = colors.statusBar === 'dark'
  const accentText = light ? '#9A3F00' : '#FFC9A3'
  const feetColor = light ? '#522D80' : '#E6D4FF'
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
      backgroundColor: '#F56600',
    },
    copy: { flex: 1 },
    kicker: {
      color: accentText,
      fontSize: 11,
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
    bubble: {
      alignSelf: 'center' as const,
      width: 176,
      height: 176,
      borderRadius: 88,
      borderWidth: 2,
      borderColor: light ? 'rgba(245,102,0,0.55)' : 'rgba(255,201,163,0.7)',
      backgroundColor: colors.card,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingHorizontal: 16,
    },
    arrowWrap: {
      width: 28,
      height: 28,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    arrow: {
      color: accentText,
      fontSize: 16,
      fontWeight: '700' as const,
    },
    feet: {
      color: feetColor,
      fontSize: 28,
      fontWeight: '700' as const,
      letterSpacing: -0.6,
      fontVariant: ['tabular-nums' as const],
    },
    compass: {
      color: accentText,
      fontSize: 13,
      fontWeight: '700' as const,
      letterSpacing: 0.6,
      marginTop: 2,
    },
    facing: {
      color: colors.inkSecondary,
      fontSize: 12,
      fontWeight: '600' as const,
      textAlign: 'center' as const,
      lineHeight: 16,
      marginTop: 4,
    },
  }
}
