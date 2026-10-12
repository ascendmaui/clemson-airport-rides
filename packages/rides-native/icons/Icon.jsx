import { memo, useEffect } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { GLYPHS } from './glyphs.js'
import { ICON_TOKENS, ION_ALIASES } from './tokens.js'

let BlurView = null
let LinearGradient = null
try { BlurView = require('expo-blur').BlurView } catch { BlurView = null }
try { LinearGradient = require('expo-linear-gradient').LinearGradient } catch { LinearGradient = null }

export const SPRING = Object.freeze({ damping: 16, stiffness: 260, mass: 0.7 })

export function resolveIconName(name) {
  if (GLYPHS[name]) return name
  return ION_ALIASES[name] || 'info'
}

function tokensFor(scheme) {
  return scheme === 'dark' ? ICON_TOKENS.dark : ICON_TOKENS.light
}

/** Plain glyph. Use in dense rows. `active` swaps to the filled variant. */
export const Glyph = memo(function Glyph({ name, size = 24, color, active = false, scheme = 'light', knockout, strokeWidth = 1.75, style, accessibilityLabel }) {
  const t = tokensFor(scheme)
  const glyph = GLYPHS[resolveIconName(name)]
  const tint = color || (active ? t.orange : t.ink)
  const filled = active && glyph.f
  const hole = knockout || t.surface
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}
      accessibilityLabel={accessibilityLabel} accessible={!!accessibilityLabel}>
      {filled ? glyph.f.map((d, i) => <Path key={`f${i}`} d={d} fill={tint} />) : null}
      {glyph.s.map((d, i) => (
        <Path key={`s${i}`} d={d} stroke={tint} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {filled && glyph.k ? glyph.k.map((d, i) => (
        <Path key={`k${i}`} d={d} stroke={hole} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      )) : null}
    </Svg>
  )
})

/** Icon with a UI-thread spring between resting and active states. */
export const Icon = memo(function Icon({ active = false, animated = true, ...rest }) {
  const on = useSharedValue(active ? 1 : 0)
  useEffect(() => {
    on.value = animated ? withSpring(active ? 1 : 0, SPRING) : active ? 1 : 0
  }, [active, animated, on])
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(on.value, [0, 0.5, 1], [1, 1.12, 1.04]) }],
    opacity: interpolate(on.value, [0, 1], [0.88, 1]),
  }))
  return (
    <Animated.View style={style}>
      <Glyph active={active} {...rest} />
    </Animated.View>
  )
})

/**
 * Liquid-glass circular badge for feature markers and the tab bar.
 * Translucent blur, soft gradient fill, layered shadow. tone: neutral | orange | purple.
 */
export const GlassBadge = memo(function GlassBadge({ name, size = 44, tone = 'orange', scheme = 'light', active = false, iconSize, color, style }) {
  const t = tokensFor(scheme)
  const accent = tone === 'purple' ? [t.purple, t.purpleDeep] : tone === 'neutral' ? [t.glass, t.glass] : [t.orange, t.orangeDeep]
  const glow = active ? 1 : 0
  const tint = color || (tone === 'neutral' ? t.ink : active ? '#FFFFFF' : accent[0])
  const g = Math.round(size * 0.5)
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2 }, shadowFor(t, glow), style]}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: t.glassEdge }]}>
        {BlurView && Platform.OS !== 'web' ? <BlurView intensity={40} tint={scheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: t.glass }]} />}
        {LinearGradient ? (
          <LinearGradient
            colors={active ? accent : [hexA(accent[0], 0.22), hexA(accent[1], 0.08)]}
            start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }} style={StyleSheet.absoluteFill} />
        ) : <View style={[StyleSheet.absoluteFill, { backgroundColor: active ? accent[0] : hexA(accent[0], 0.16) }]} />}
        {LinearGradient ? (
          <LinearGradient colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.55 }}
            style={[StyleSheet.absoluteFill, { opacity: scheme === 'dark' ? 0.25 : 0.6 }]} />
        ) : null}
      </View>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Glyph name={name} size={iconSize || g} color={tint} active={active} scheme={scheme} knockout={active ? accent[0] : undefined} />
      </View>
    </View>
  )
})

function shadowFor(t, glow) {
  return Platform.select({
    ios: { shadowColor: t.shadow, shadowOpacity: 0.1 + glow * 0.08, shadowRadius: 10 + glow * 4, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 3 + glow * 3 },
    default: { boxShadow: `0 1px 2px rgba(20,16,30,0.08), 0 6px ${14 + glow * 6}px rgba(20,16,30,${0.1 + glow * 0.08})` },
  })
}

function hexA(color, alpha) {
  if (!color.startsWith('#') || color.length !== 7) return color
  const n = parseInt(color.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** Pressable with a UI-thread spring press-scale (0.96) and opacity dip. */
export function PressScale({ children, style, scaleTo = 0.96, onPressIn, onPressOut, ...rest }) {
  const p = useSharedValue(0)
  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - p.value * (1 - scaleTo) }],
    opacity: 1 - p.value * 0.12,
  }))
  return (
    <Pressable
      {...rest}
      onPressIn={(e) => { p.value = withTiming(1, { duration: 120 }); onPressIn?.(e) }}
      onPressOut={(e) => { p.value = withSpring(0, SPRING); onPressOut?.(e) }}
    >
      <Animated.View style={style}>{children}</Animated.View>
    </Pressable>
  )
}
