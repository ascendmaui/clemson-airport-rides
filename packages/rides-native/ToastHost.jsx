import { BlurView } from 'expo-blur'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { currentToast, dismissToast, subscribeToasts } from './toastStore.js'

// Badge fills are darkened so the white glyph stays above 4.5:1.
// The rail keeps the brand orange and purple at full strength.
const ACCENT = {
  info: '#522D80',
  success: '#156938',
  warning: '#9A3F00',
  error: '#B42318',
}
const RAIL = {
  info: '#522D80',
  success: '#1F8A4C',
  warning: '#F56600',
  error: '#D92D20',
}
const GLYPH = { info: 'i', success: '✓', warning: '!', error: '×' }
const HIDDEN_Y = -160
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1)

/**
 * Glass toast. Springs down from the top, auto-dismisses, and can be flicked
 * up to dismiss. Reduced motion skips the travel and shows the toast in place.
 * Mount once near the root of each app.
 */
export function ToastHost({ scheme = 'light' }) {
  const insets = useSafeAreaInsets()
  const [toast, setToast] = useState(currentToast())
  const y = useRef(new Animated.Value(HIDDEN_Y)).current
  const drag = useRef(new Animated.Value(0)).current
  const timer = useRef(null)
  const reduceMotion = useRef(false)
  const idRef = useRef(null)
  idRef.current = toast?.id ?? null

  useEffect(() => subscribeToasts(setToast), [])

  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled?.().then((value) => {
      if (alive) reduceMotion.current = Boolean(value)
    }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value) => {
      reduceMotion.current = Boolean(value)
    })
    return () => {
      alive = false
      sub?.remove?.()
    }
  }, [])

  function hide(id) {
    if (timer.current) clearTimeout(timer.current)
    Animated.timing(y, {
      toValue: HIDDEN_Y,
      duration: reduceMotion.current ? 0 : 220,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start(() => {
      drag.setValue(0)
      if (idRef.current === id) dismissToast(id)
    })
  }

  useEffect(() => {
    if (!toast) return undefined
    drag.setValue(0)
    if (reduceMotion.current) y.setValue(0)
    else Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 220, mass: 0.8 }).start()
    AccessibilityInfo.announceForAccessibility?.(toast.body ? `${toast.title}. ${toast.body}` : toast.title)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => hide(toast.id), toast.durationMs)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [toast])

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
    onPanResponderMove: (_e, g) => drag.setValue(Math.min(8, g.dy)),
    onPanResponderRelease: (_e, g) => {
      if (g.dy < -24 || g.vy < -0.6) hide(idRef.current)
      else Animated.spring(drag, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 260 }).start()
    },
    onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 260 }).start(),
  }), [])

  if (!toast) return null
  const dark = scheme === 'dark'
  const accent = ACCENT[toast.tone] || ACCENT.info
  const rail = RAIL[toast.tone] || RAIL.info

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 8 }]}>
      <Animated.View
        {...responder.panHandlers}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.shell, { transform: [{ translateY: Animated.add(y, drag) }] }]}
      >
        <BlurView
          intensity={Platform.OS === 'ios' ? 60 : 90}
          tint={dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
          style={[styles.glass, { backgroundColor: dark ? 'rgba(22,18,31,0.78)' : 'rgba(255,255,255,0.82)', borderColor: dark ? 'rgba(255,255,255,0.14)' : 'rgba(82,45,128,0.10)' }]}
        >
          <Pressable
            onPress={() => {
              toast.onPress?.()
              hide(toast.id)
            }}
            accessibilityLabel={toast.body ? `${toast.title}. ${toast.body}` : toast.title}
            accessibilityHint="Swipe up to dismiss"
            style={styles.row}
          >
            <View style={[styles.rail, { backgroundColor: rail }]} />
            <View style={[styles.badge, { backgroundColor: accent }]}>
              <Text style={styles.glyph}>{toast.icon || GLYPH[toast.tone]}</Text>
            </View>
            <View style={styles.copy}>
              <Text numberOfLines={1} style={[styles.title, { color: dark ? '#FFFFFF' : '#141218' }]}>{toast.title}</Text>
              {toast.body ? (
                <Text numberOfLines={2} style={[styles.body, { color: dark ? '#E4E0EA' : '#3E4654' }]}>{toast.body}</Text>
              ) : null}
            </View>
          </Pressable>
        </BlurView>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 16, right: 16, zIndex: 1000, elevation: 1000, alignItems: 'center' },
  shell: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 22,
    shadowColor: '#1A1033',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  glass: { borderRadius: 22, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingLeft: 16, paddingRight: 16, minHeight: 64 },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  glyph: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
})
