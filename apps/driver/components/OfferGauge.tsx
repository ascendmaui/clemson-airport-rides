/**
 * "Worth-it" $/hr pill + arc for the driver offer card.
 * All motion runs on the UI thread via Reanimated; reduce-motion keeps colors with static effects.
 */
import { useEffect, useMemo } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { glowStyle as glowStyleFor, shadowStyle } from 'rides-native/shared/theme.js'
import * as Haptics from 'expo-haptics'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { GAUGE_PALETTE, type GaugeEffects, type GaugeTier } from 'rides-native/offerGauge'
import { useTheme } from '@/lib/theme'
import { Glyph } from 'rides-native/icons'

type Gauge = {
  text: string
  tier: GaugeTier | null
  tierLabel: string | null
  fill: number
  level: number | null
  effects: GaugeEffects
  accessibilityLabel: string
}

const ARC = 30
const STROKE = 4

/** Gentle, critically-damped spring shared by the gauge (no overshoot wobble on a money number). */
const SPRING = { damping: 18, stiffness: 140, mass: 0.9 }

/** Semicircle arc built from two clipped rings (no SVG dependency). Fill eases in over 240 ms. */
function Arc({ fill, color, track, still }: { fill: number; color: string; track: string; still: boolean }) {
  const target = Math.max(0, Math.min(1, fill))
  const f = useSharedValue(still ? target : 0)
  useEffect(() => {
    f.value = still ? target : withTiming(target, { duration: 240, easing: Easing.bezier(0.22, 1, 0.36, 1) })
  }, [target, still, f])
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-180 + 180 * f.value + 45}deg` }] }))
  return (
    <View style={{ width: ARC, height: ARC / 2, overflow: 'hidden' }} importantForAccessibility="no-hide-descendants">
      <View style={[styles.ring, { borderColor: track }]} />
      <Animated.View style={[styles.ring, { borderColor: 'transparent', borderTopColor: color, borderLeftColor: color }, fillStyle]} />
    </View>
  )
}

function Sparkle({ index, count, color, still }: { index: number; count: number; color: string; still: boolean }) {
  const t = useSharedValue(still ? 0.6 : 0)
  useEffect(() => {
    if (still) return undefined
    t.value = withDelay(index * 180, withRepeat(withSequence(
      withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 680, easing: Easing.in(Easing.quad) }),
    ), -1))
    return () => cancelAnimation(t)
  }, [still, index, t])
  const angle = (index / count) * Math.PI * 2
  const style = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ scale: 0.4 + t.value * 0.6 }] }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.sparkle, { backgroundColor: color, left: `${50 + Math.cos(angle) * 54}%`, top: `${50 + Math.sin(angle) * 70}%` }, style]}
    />
  )
}

export function OfferGauge({ gauge, offerId }: { gauge: Gauge; offerId: string }) {
  const { scheme } = useTheme()
  const reduce = useReducedMotion()
  const tier = gauge.tier ?? 'orange'
  const swatch = GAUGE_PALETTE[tier][scheme === 'dark' ? 'dark' : 'light']
  const fx = gauge.effects
  const fancy = Boolean(swatch.gradient)

  const sweep = useSharedValue(0)
  const glow = useSharedValue(fx.glow)
  const spin = useSharedValue(0)
  const burst = useSharedValue(0)

  useEffect(() => {
    if (reduce) {
      sweep.value = 0.5
      glow.value = fx.glow
      return undefined
    }
    if (fx.shimmerMs > 0) {
      sweep.value = 0
      sweep.value = withRepeat(withTiming(1, { duration: fx.shimmerMs, easing: Easing.inOut(Easing.cubic) }), -1)
    }
    if (fx.glow > 0) {
      glow.value = withRepeat(withSequence(
        withTiming(fx.glow, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
        withTiming(fx.glow * 0.45, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
      ), -1, true)
    }
    if (fx.ring) spin.value = withRepeat(withTiming(360, { duration: fx.crown ? 6000 : 4200, easing: Easing.linear }), -1)
    if (fx.burst) burst.value = withSequence(withSpring(1, SPRING), withTiming(0.6, { duration: 280, easing: Easing.out(Easing.cubic) }))
    return () => {
      cancelAnimation(sweep)
      cancelAnimation(glow)
      cancelAnimation(spin)
      cancelAnimation(burst)
    }
  }, [reduce, fx.shimmerMs, fx.glow, fx.ring, fx.burst, fx.crown, sweep, glow, spin, burst])

  // One celebratory moment per offer: Crown = single success, Diamond V = double tap.
  useEffect(() => {
    if (!fx.haptics) return undefined
    let cancelled = false
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    const timer = fx.haptics > 1
      ? setTimeout(() => { if (!cancelled) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}) }, 140)
      : null
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [offerId, fx.haptics])

  const sweepStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -80 + sweep.value * 220 }, { rotate: '18deg' }] }))
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value, shadowOpacity: glow.value }))
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }))
  const burstStyle = useAnimatedStyle(() => ({ opacity: burst.value * 0.7, transform: [{ scale: 0.9 + burst.value * 0.35 }] }))
  const sparkles = useMemo(() => Array.from({ length: fx.sparkles }, (_, i) => i), [fx.sparkles])

  return (
    <View style={styles.wrap} accessible accessibilityRole="text" accessibilityLabel={gauge.accessibilityLabel}>
      {fx.glow > 0 ? (
        <Animated.View pointerEvents="none" style={[glowStyleFor(swatch.accent, Platform.OS), styles.glow, { backgroundColor: swatch.accent }, glowStyle]} />
      ) : null}
      {fx.burst ? (
        <Animated.View pointerEvents="none" style={[styles.burst, { borderColor: swatch.accent }, burstStyle]} />
      ) : null}
      {fx.ring ? (
        <Animated.View pointerEvents="none" style={[styles.ring2, { borderTopColor: swatch.accent, borderRightColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: swatch.accent }, ringStyle]} />
      ) : null}
      <View style={[styles.lift, shadowStyle(swatch.accent, 'float', scheme)]}>
      <View style={[styles.pill, { backgroundColor: swatch.bg, borderColor: swatch.accent }]}>
        {fancy ? (
          <LinearGradient colors={swatch.gradient as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        ) : null}
        {fx.shimmerMs > 0 ? (
          <Animated.View pointerEvents="none" style={[styles.sweep, sweepStyle]}>
            <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
        ) : null}
        <Arc fill={gauge.fill} color={tier === 'crown' ? '#FFFFFF' : swatch.accent} track={scheme === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.10)'} still={reduce} />
        <View>
          <View style={styles.valueRow}>
            {tier === 'crown' ? <Glyph name="sparkle" size={14} color={swatch.fg} active /> : null}
            <Text style={[styles.value, { color: swatch.fg }]}>{gauge.text}</Text>
          </View>
          {gauge.tierLabel ? <Text style={[styles.label, { color: swatch.fg }]}>{gauge.tierLabel}</Text> : null}
        </View>
        {sparkles.map((i) => (
          <Sparkle key={i} index={i} count={sparkles.length} color={tier === 'crown' ? '#FFE9A8' : '#FFFFFF'} still={reduce} />
        ))}
      </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999, borderWidth: 1, overflow: 'hidden', minHeight: 44,
  },
  // Contact shadow plus a soft tinted lift. Kept light so the pay number stays the focus.
  lift: { borderRadius: 999 },
  ring: { position: 'absolute', width: ARC, height: ARC, borderRadius: ARC / 2, borderWidth: STROKE },
  value: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -0.4 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 1 },
  sweep: { position: 'absolute', top: -20, bottom: -20, width: 28 },
  glow: { position: 'absolute', top: -8, bottom: -8, left: -8, right: -8, borderRadius: 999, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } },
  burst: { position: 'absolute', top: -10, bottom: -10, left: -10, right: -10, borderRadius: 999, borderWidth: 1 },
  ring2: { position: 'absolute', top: -3, bottom: -3, left: -3, right: -3, borderRadius: 999, borderWidth: 1.5 },
  sparkle: { position: 'absolute', width: 3, height: 3, borderRadius: 1.5, marginLeft: -1.5, marginTop: -1.5 },
})
