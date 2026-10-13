import { Platform, StyleSheet, View } from 'react-native'
import { glassFill, glassRecipe, glassShowsStreak } from './tokens.js'

let BlurView = null
let LinearGradient = null
try { BlurView = require('expo-blur').BlurView } catch { BlurView = null }
try { LinearGradient = require('expo-linear-gradient').LinearGradient } catch { LinearGradient = null }

const PAD_KEYS = [
  'padding', 'paddingHorizontal', 'paddingVertical',
  'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
]
const FLOW_KEYS = ['alignItems', 'justifyContent', 'flexDirection', 'gap', 'flexWrap']

/**
 * Frosted glass plate: blur (or a milky fallback), brand tint, top specular
 * highlight, diagonal streak, hairline light border, and two soft shadows.
 */
export function GlassSurface({
  children,
  app = 'rider',
  scheme = 'light',
  variant = 'surface',
  accent,
  style,
  selected = false,
  edges = 'all',
  showStreak = true,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
  pointerEvents,
}) {
  const recipe = glassRecipe({ app, scheme, variant, accent })
  const flat = StyleSheet.flatten(style) || {}
  const pad = {}
  const flow = {}
  const rest = {}
  for (const [key, value] of Object.entries(flat)) {
    if (PAD_KEYS.includes(key)) pad[key] = value
    else if (FLOW_KEYS.includes(key)) flow[key] = value
    else if (!STRIPPED.has(key)) rest[key] = value
  }
  const radius = Number(flat.borderRadius ?? recipe.radius)
  const radii = edges === 'top'
    ? { borderTopLeftRadius: radius, borderTopRightRadius: radius }
    : { borderRadius: radius }
  const dark = scheme === 'dark'
  const fill = glassFill(recipe)
  const showBlur = Boolean(BlurView) && Platform.OS !== 'web'
  const paintStreak = showStreak !== false && glassShowsStreak({ variant, accent: recipe.accent })
  const filled = variant === 'fab' || variant === 'primary' || variant === 'secondary' || variant === 'chip' || variant === 'ghost'
  return (
    <View
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      pointerEvents={pointerEvents}
      style={[rest, radii, layeredShadow(dark, recipe.tint)]}
    >
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, radii]}>
        {showBlur
          ? <BlurView intensity={recipe.blur} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          : <View style={[StyleSheet.absoluteFill, styles.fallback, { backgroundColor: fill }]} />}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
        <GlassSheen scheme={scheme} radius={radius} selected={selected} tint={recipe.tint} specular={recipe.specular} streak={recipe.streak} showStreak={paintStreak} edges={edges} />
      </View>
      <View style={[filled ? styles.fill : styles.content, flow, pad]}>{children}</View>
    </View>
  )
}

export function GlassSheen({
  scheme = 'light',
  radius = 22,
  selected = false,
  tint = '#F56600',
  specular = 0.62,
  streak = 0.72,
  showStreak = true,
  edges = 'all',
}) {
  const dark = scheme === 'dark'
  const radii = edges === 'top'
    ? { borderTopLeftRadius: radius, borderTopRightRadius: radius }
    : { borderRadius: radius }
  const borderTop = selected ? tint : (dark ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.96)')
  const borderSide = selected ? tint : (dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.62)')
  const borderBottom = selected ? tint : (dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.34)')
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, radii]}>
      {LinearGradient ? (
        <LinearGradient
          colors={[`rgba(255,255,255,${specular})`, 'rgba(255,255,255,0)']}
          start={{ x: 0.12, y: 0 }}
          end={{ x: 0.55, y: 0.48 }}
          style={styles.specular}
        />
      ) : (
        <View style={[styles.specular, { backgroundColor: `rgba(255,255,255,${Math.min(0.28, specular * 0.4)})` }]} />
      )}
      {showStreak ? (LinearGradient ? (
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.05)', `rgba(255,255,255,${streak})`, 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0)']}
          locations={[0, 0.42, 0.5, 0.58, 1]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.streak}
        />
      ) : (
        <View style={[styles.streak, styles.streakFallback]} />
      )) : null}
      <View
        style={[
          StyleSheet.absoluteFill,
          radii,
          {
            borderWidth: selected ? 1.5 : 1,
            borderTopColor: borderTop,
            borderLeftColor: borderSide,
            borderRightColor: borderSide,
            borderBottomColor: borderBottom,
          },
        ]}
      />
    </View>
  )
}

const STRIPPED = new Set([
  'backgroundColor', 'borderColor', 'borderWidth', 'borderTopWidth', 'borderBottomWidth',
  'borderLeftWidth', 'borderRightWidth', 'borderRadius', 'overflow',
  'shadowColor', 'shadowOpacity', 'shadowRadius', 'shadowOffset', 'elevation',
])

function contactShadow() {
  return { shadowColor: '#1A1033', shadowOpacity: 0.14, shadowRadius: 1.5, shadowOffset: { width: 0, height: 1 }, elevation: 2 }
}

function ambientShadow(dark, tint) {
  return {
    shadowColor: dark ? '#000000' : tint,
    shadowOpacity: dark ? 0.36 : 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  }
}

function layeredShadow(dark, tint) {
  const contact = contactShadow()
  const ambient = ambientShadow(dark, tint)
  return {
    ...ambient,
    elevation: Platform.OS === 'android' ? ambient.elevation : contact.elevation,
    boxShadow: `0 1px 1.5px rgba(20,16,30,${contact.shadowOpacity}), 0 ${ambient.shadowOffset.height}px ${ambient.shadowRadius}px ${dark ? 'rgba(0,0,0,0.36)' : 'rgba(26,16,51,0.16)'}`,
  }
}

const styles = StyleSheet.create({
  shell: { overflow: 'visible' },
  clip: { overflow: 'hidden' },
  fallback: {},
  content: {},
  fill: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  specular: { position: 'absolute', left: 0, right: 0, top: 0, height: '48%' },
  streak: {
    position: 'absolute',
    width: '170%',
    height: 12,
    top: '18%',
    left: '-32%',
    transform: [{ rotate: '-32deg' }],
  },
  streakFallback: { backgroundColor: 'rgba(255,255,255,0.28)' },
})
