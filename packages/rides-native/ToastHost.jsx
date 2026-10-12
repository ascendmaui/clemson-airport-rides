import { BlurView } from 'expo-blur'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { currentToast, dismissToast, subscribeToasts } from './toastStore.js'

const ACCENT = {
  info: '#522D80',
  success: '#1E9E5A',
  warning: '#F56600',
  error: '#D93025',
}
const GLYPH = { info: 'i', success: '✓', warning: '!', error: '×' }
const HIDDEN_Y = -160

/**
 * iOS 26-style glass toast. Springs down from the top, auto-dismisses, and
 * can be flicked up to dismiss. Mount once near the root of each app.
 */
export function ToastHost({ scheme = 'light' }) {
  const insets = useSafeAreaInsets()
  const [toast, setToast] = useState(currentToast())
  const y = useRef(new Animated.Value(HIDDEN_Y)).current
  const drag = useRef(new Animated.Value(0)).current
  const timer = useRef(null)
  const idRef = useRef(null)
  idRef.current = toast?.id ?? null

  useEffect(() => subscribeToasts(setToast), [])

  function hide(id) {
    if (timer.current) clearTimeout(timer.current)
    Animated.timing(y, { toValue: HIDDEN_Y, duration: 200, useNativeDriver: true }).start(() => {
      drag.setValue(0)
      if (idRef.current === id) dismissToast(id)
    })
  }

  useEffect(() => {
    if (!toast) return undefined
    drag.setValue(0)
    Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 16, stiffness: 190, mass: 0.9 }).start()
    AccessibilityInfo.announceForAccessibility?.(toast.body ? `${toast.title}. ${toast.body}` : toast.title)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => hide(toast.id), toast.durationMs)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [toast])

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
    onPanResponderMove: (_e, g) => drag.setValue(Math.min(12, g.dy)),
    onPanResponderRelease: (_e, g) => {
      if (g.dy < -24 || g.vy < -0.6) hide(idRef.current)
      else Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 8 }).start()
    },
    onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start(),
  }), [])

  if (!toast) return null
  const dark = scheme === 'dark'
  const accent = ACCENT[toast.tone] || ACCENT.info

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 6 }]}>
      <Animated.View
        {...responder.panHandlers}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.shell, { transform: [{ translateY: Animated.add(y, drag) }] }]}
      >
        <BlurView
          intensity={Platform.OS === 'ios' ? 60 : 90}
          tint={dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
          style={[styles.glass, { backgroundColor: dark ? 'rgba(28,28,32,0.62)' : 'rgba(255,255,255,0.66)', borderColor: dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.8)' }]}
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
            <View style={[styles.badge, { backgroundColor: accent }]}>
              <Text style={styles.glyph}>{toast.icon || GLYPH[toast.tone]}</Text>
            </View>
            <View style={styles.copy}>
              <Text numberOfLines={1} style={[styles.title, { color: dark ? '#FFFFFF' : '#111114' }]}>{toast.title}</Text>
              {toast.body ? (
                <Text numberOfLines={2} style={[styles.body, { color: dark ? 'rgba(235,235,245,0.7)' : 'rgba(60,60,67,0.75)' }]}>{toast.body}</Text>
              ) : null}
            </View>
          </Pressable>
        </BlurView>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 12, right: 12, zIndex: 1000, elevation: 1000, alignItems: 'center' },
  shell: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 26,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  glass: { borderRadius: 26, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, minHeight: 56 },
  badge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  glyph: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  copy: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 13, fontWeight: '500', marginTop: 1, lineHeight: 17 },
})
