import { useEffect } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { useReduceMotion } from '../shared/reduceMotion.js'
import { type as typeScale } from '../shared/theme.js'
import { GlassSurface, nativeGlassAvailable } from './GlassSurface.jsx'
import { GLASS_PRESS, glassRecipe } from './tokens.js'

const SPRING = Object.freeze({ damping: 16, stiffness: 260, mass: 0.7 })

const LAYOUT_KEYS = ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'flex', 'flexGrow', 'flexShrink', 'alignSelf']

function mergedSurfaceStyle(variant, style) {
  const parts = [styles.surface]
  if (variant === 'chip' || variant === 'fab') parts.push(styles.inline)
  if (style) parts.push(style)
  const flat = { ...(StyleSheet.flatten(parts) || {}) }
  if (flat.padding != null) {
    delete flat.paddingVertical
    delete flat.paddingHorizontal
    delete flat.paddingTop
    delete flat.paddingBottom
    delete flat.paddingLeft
    delete flat.paddingRight
  }
  return flat
}

function pressLayout(style, variant) {
  const flat = StyleSheet.flatten(style) || {}
  const layout = {}
  for (const key of LAYOUT_KEYS) {
    if (flat[key] != null) layout[key] = flat[key]
  }
  if (variant === 'chip' && layout.alignSelf == null) layout.alignSelf = 'flex-start'
  else if (layout.alignSelf == null && layout.width == null && layout.flex == null) layout.alignSelf = 'stretch'
  return layout
}

/**
 * Pressable glass control. Scale runs on the UI thread.
 * The blur fallback also dips opacity. Native Liquid Glass never animates
 * opacity, because opacity 0 leaves UIGlassEffect blank.
 * Reduced motion snaps the press state instead of springing it.
 */
export function GlassButton({
  label,
  children,
  onPress,
  disabled,
  variant = 'primary',
  app = 'rider',
  scheme = 'light',
  accent,
  selected = false,
  showStreak = true,
  style,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityHint,
  accessibilityState,
  hitSlop,
  onPressIn,
  onPressOut,
}) {
  const reduce = useReduceMotion()
  const pressed = useSharedValue(0)
  const disabledSv = useSharedValue(disabled ? 1 : 0)
  useEffect(() => {
    disabledSv.value = disabled ? 1 : 0
  }, [disabled, disabledSv])
  const nativeGlass = nativeGlassAvailable()
  const anim = useAnimatedStyle(() => {
    const down = pressed.value
    const off = disabledSv.value
    const scale = off ? 1 : 1 - down * (1 - GLASS_PRESS.scale)
    if (nativeGlass) return { transform: [{ scale }] }
    const opacity = (off ? GLASS_PRESS.disabledOpacity : 1) * (1 - down * GLASS_PRESS.opacityDip)
    return { transform: [{ scale }], opacity }
  })
  const text = glassRecipe({ app, scheme, variant, accent }).text
  const content = children ?? (
    label != null ? <Text style={[styles.label, { color: text }]}>{label}</Text> : null
  )
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || (typeof label === 'string' ? label : undefined)}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        ...accessibilityState,
        disabled: Boolean(disabled),
        ...(selected ? { selected: true } : {}),
      }}
      hitSlop={hitSlop}
      onPressIn={(event) => {
        pressed.value = reduce ? 1 : withTiming(1, { duration: GLASS_PRESS.durationMs })
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        pressed.value = reduce ? 0 : withSpring(0, SPRING)
        onPressOut?.(event)
      }}
      style={pressLayout(style, variant)}
    >
      <Animated.View style={anim}>
        <GlassSurface app={app} scheme={scheme} variant={variant} accent={accent} selected={selected} showStreak={showStreak} style={mergedSurfaceStyle(variant, style)}>
          {content}
        </GlassSurface>
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  surface: { alignItems: 'center', justifyContent: 'center', paddingVertical: 16, paddingHorizontal: 16 },
  inline: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14 },
  label: {
    fontWeight: typeScale.button.fontWeight,
    fontSize: typeScale.button.fontSize,
    letterSpacing: typeScale.button.letterSpacing,
    textAlign: 'center',
  },
})
