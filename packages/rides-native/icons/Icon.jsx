import { memo, useId, useEffect } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg'
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { ICON_TOKENS } from './tokens.js'
import { glyphLayers, resolveIconName, opticalStroke } from './layers.js'

let BlurView = null
let LinearGradient = null
try { BlurView = require('expo-blur').BlurView } catch { BlurView = null }
try { LinearGradient = require('expo-linear-gradient').LinearGradient } catch { LinearGradient = null }

export const SPRING = Object.freeze({ damping: 16, stiffness: 260, mass: 0.7 })
export { resolveIconName, opticalStroke }

function tokensFor(scheme) {
  return scheme === 'dark' ? ICON_TOKENS.dark : ICON_TOKENS.light
}

/**
 * Plain glyph. Resting: optically-sized stroke over a soft tinted wash with the
 * orange route-dot accent. Active: gradient fill, specular sheen, knockouts.
 */
export const Glyph = memo(function Glyph({ name, size = 24, color, active = false, scheme = 'light', knockout, strokeWidth, style, accessibilityLabel }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const layers = glyphLayers(name, { active, scheme, color, knockout, size, strokeWidth })
  const defs = []
  const paths = layers.map((l, i) => {
    if (l.kind === 'fill') {
      defs.push(
        <SvgGradient key={`gf${i}`} id={`${uid}f${i}`} x1="0.15" y1="0" x2="0.85" y2="1">
          <Stop offset="0" stopColor={l.gradient[0]} /><Stop offset="0.45" stopColor={l.gradient[1]} /><Stop offset="1" stopColor={l.gradient[2]} />
        </SvgGradient>,
      )
      return <Path key={i} d={l.d} fill={`url(#${uid}f${i})`} />
    }
    if (l.kind === 'specular') {
      defs.push(
        <SvgGradient key={`gs${i}`} id={`${uid}s${i}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.42} /><Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0} />
        </SvgGradient>,
      )
      return <Path key={i} d={l.d} fill={`url(#${uid}s${i})`} />
    }
    if (l.kind === 'wash' || l.kind === 'accent') return <Path key={i} d={l.d} fill={l.fill} fillOpacity={l.opacity ?? 1} />
    return <Path key={i} d={l.d} stroke={l.stroke} strokeWidth={l.strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  })
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}
      accessibilityLabel={accessibilityLabel} accessible={!!accessibilityLabel}>
      {defs.length ? <Defs>{defs}</Defs> : null}
      {paths}
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
 * Layered glass badge. Back to front: two soft shadows (contact + ambient),
 * blur, tone gradient, inner top highlight, bottom inner shade, specular rim
 * (bright top edge fading to a hairline), then the glyph.
 * tone: neutral | orange | purple.
 */
export const GlassBadge = memo(function GlassBadge({ name, size = 44, tone = 'orange', scheme = 'light', active = false, iconSize, color, style }) {
  const t = tokensFor(scheme)
  const dark = scheme === 'dark'
  const accent = tone === 'purple' ? [t.purpleLight, t.purple, t.purpleDeep] : tone === 'neutral' ? [t.glass, t.glass, t.glass] : [t.orangeLight, t.orange, t.orangeDeep]
  const glow = active ? 1 : 0
  const tint = color || (tone === 'neutral' ? t.ink : active ? '#FFFFFF' : dark && tone === 'purple' ? t.purpleLight : accent[1])
  const r = size / 2
  const fill = active ? accent : [hexA(accent[0], dark ? 0.3 : 0.24), hexA(accent[1], dark ? 0.16 : 0.12), hexA(accent[2], dark ? 0.22 : 0.16)]
  return (
    <View style={[{ width: size, height: size, borderRadius: r }, ambientShadow(t, glow, active ? accent[1] : null), style]}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: r }, contactShadow(t)]} />
      <View style={[StyleSheet.absoluteFill, { borderRadius: r, overflow: 'hidden' }]}>
        {BlurView && Platform.OS !== 'web' ? <BlurView intensity={40} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: t.glass }]} />}
        {LinearGradient ? (
          <LinearGradient colors={fill} locations={[0, 0.5, 1]} start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }} style={StyleSheet.absoluteFill} />
        ) : <View style={[StyleSheet.absoluteFill, { backgroundColor: fill[1] }]} />}
        {LinearGradient ? (
          <LinearGradient colors={[`rgba(255,255,255,${dark ? 0.22 : active ? 0.38 : 0.7})`, 'rgba(255,255,255,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.5 }}
            style={{ position: 'absolute', left: size * 0.12, right: size * 0.12, top: size * 0.04, height: size * 0.5, borderRadius: size }} />
        ) : null}
        {LinearGradient ? (
          <LinearGradient colors={['rgba(0,0,0,0)', `rgba(20,10,40,${dark ? 0.28 : active ? 0.18 : 0.06})`]} start={{ x: 0.5, y: 0.55 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
        ) : null}
      </View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
        borderRadius: r, borderWidth: 1, borderTopColor: t.specular, borderLeftColor: t.glassEdge, borderRightColor: t.glassEdge,
        borderBottomColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.35)',
      }]} />
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Glyph name={name} size={iconSize || Math.round(size * 0.52)} color={tint} active={active} scheme={scheme} knockout={active ? accent[1] : undefined} />
      </View>
    </View>
  )
})

function contactShadow(t) {
  return Platform.select({
    ios: { shadowColor: t.shadow, shadowOpacity: 0.14, shadowRadius: 1.5, shadowOffset: { width: 0, height: 1 } },
    android: {},
    default: { boxShadow: '0 1px 1.5px rgba(20,16,30,0.14)' },
  })
}

function ambientShadow(t, glow, glowColor) {
  return Platform.select({
    ios: { shadowColor: glowColor || t.shadow, shadowOpacity: 0.12 + glow * 0.16, shadowRadius: 14 + glow * 6, shadowOffset: { width: 0, height: 6 + glow * 2 } },
    android: { elevation: 4 + glow * 4 },
    default: { boxShadow: `0 2px 4px rgba(20,16,30,0.08), 0 ${6 + glow * 2}px ${16 + glow * 8}px ${glowColor ? hexA(glowColor, 0.32) : 'rgba(20,16,30,0.14)'}` },
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
