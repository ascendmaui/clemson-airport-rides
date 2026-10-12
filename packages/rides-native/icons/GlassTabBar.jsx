import { useEffect, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { Icon, SPRING } from './Icon.jsx'
import { ICON_TOKENS } from './tokens.js'

let BlurView = null
try { BlurView = require('expo-blur').BlurView } catch { BlurView = null }

/**
 * iOS 26-style floating glass tab bar. A single spring-driven pill slides under
 * the active tab on the UI thread; each icon springs to its filled variant.
 */
export function GlassTabBar({ tabs, activeIndex, onSelect, scheme = 'light', bottomInset = 0, accent }) {
  const t = scheme === 'dark' ? ICON_TOKENS.dark : ICON_TOKENS.light
  const tint = accent || t.orange
  const [width, setWidth] = useState(0)
  const slot = width > 0 ? (width - 12) / tabs.length : 0
  const x = useSharedValue(0)
  const placed = useRef(false)
  useEffect(() => {
    if (slot <= 0) return
    // First layout snaps into place; later switches glide with a clamped spring.
    if (!placed.current) {
      placed.current = true
      x.value = activeIndex * slot
      return
    }
    x.value = withSpring(activeIndex * slot, { ...SPRING, overshootClamping: true })
  }, [activeIndex, slot, x])
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(bottomInset, 10) }]}>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={[styles.bar, shadow(t), { borderColor: t.glassEdge }]}
      >
        <View style={[StyleSheet.absoluteFill, styles.clip]}>
          {BlurView && Platform.OS !== 'web'
            ? <BlurView intensity={60} tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'} style={StyleSheet.absoluteFill} />
            : null}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: scheme === 'dark' ? 'rgba(22,18,31,0.72)' : 'rgba(255,255,255,0.74)' }]} />
        </View>
        {slot > 0 ? (
          <Animated.View style={[styles.pill, { width: slot, backgroundColor: scheme === 'dark' ? 'rgba(255,138,61,0.18)' : 'rgba(242,112,28,0.12)' }, pill]} />
        ) : null}
        {tabs.map((tab, i) => (
          <TabButton key={tab.id} tab={tab} on={i === activeIndex} tint={tint} muted={t.muted} scheme={scheme} onPress={() => onSelect(tab, i)} />
        ))}
      </View>
    </View>
  )
}

function TabButton({ tab, on, tint, muted, scheme, onPress }) {
  const press = useSharedValue(0)
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.value * 0.08 }] }))
  const color = on ? tint : muted
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      onPressIn={() => { press.value = withTiming(1, { duration: 110 }) }}
      onPressOut={() => { press.value = withSpring(0, SPRING) }}
      style={styles.item}
    >
      <Animated.View style={[styles.itemInner, style]}>
        <Icon name={tab.icon} size={24} active={on} color={color} scheme={scheme} knockout={scheme === 'dark' ? '#2A2233' : '#FDEFE6'} />
        <Text numberOfLines={1} style={[styles.label, { color, fontWeight: on ? '700' : '600' }]}>{tab.label}</Text>
      </Animated.View>
    </Pressable>
  )
}

function shadow(t) {
  return Platform.select({
    ios: { shadowColor: t.shadow, shadowOpacity: 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
    android: { elevation: 10 },
    default: { boxShadow: '0 1px 2px rgba(20,16,30,0.06), 0 10px 30px rgba(20,16,30,0.14)' },
  })
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 14, paddingTop: 6 },
  bar: { flexDirection: 'row', borderRadius: 30, padding: 6, borderWidth: StyleSheet.hairlineWidth },
  clip: { borderRadius: 30, overflow: 'hidden' },
  pill: { position: 'absolute', top: 6, bottom: 6, left: 6, borderRadius: 24 },
  item: { flex: 1 },
  itemInner: { alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 6 },
  label: { fontSize: 11, letterSpacing: 0.1 },
})
