import { useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '@/lib/theme'

type Props = {
  available: boolean
  dnd: boolean
  canStart?: boolean
  minimized?: boolean
  onChange: (available: boolean) => void
  onExpand?: () => void
  onMinimize?: () => void
}

/** Bottom-bar Start rides / Stop rides control and the smaller off-the-clock switch. */
export function StartStopRides({
  available,
  dnd,
  canStart = true,
  minimized = false,
  onChange,
  onExpand,
  onMinimize,
}: Props) {
  const { colors } = useTheme()
  const glow = useRef(new Animated.Value(0)).current
  const startBlocked = !available && !canStart
  const locked = startBlocked
  useEffect(() => {
    if (locked) {
      glow.setValue(0)
      return undefined
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [glow, locked])
  if (available && minimized) {
    return (
      <View style={styles.compact}>
        <Pressable
          onPress={onExpand}
          accessibilityRole="button"
          accessibilityLabel="You're online. Expand ride controls"
          style={styles.compactMain}
        >
          <Text style={styles.compactText}>You're online</Text>
        </Pressable>
        <Pressable
          onPress={() => onChange(false)}
          accessibilityRole="button"
          accessibilityLabel="End rides"
          style={styles.end}
        >
          <Text style={styles.endText}>End</Text>
        </Pressable>
      </View>
    )
  }
  return (
    <View style={styles.wrap}>
      <View style={styles.buttonWrap}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            {
              opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.7] }),
              transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.06] }) }],
            },
          ]}
        />
        <Pressable
          onPress={() => onChange(!available)}
          disabled={locked}
          accessibilityRole="button"
          accessibilityLabel={available ? 'Stop rides' : 'Start rides'}
          accessibilityState={{ disabled: locked, selected: available }}
          style={{ opacity: locked ? 0.55 : 1 }}
        >
          <LinearGradient
            colors={locked ? [colors.track, colors.card] : ['#F56600', '#522D80']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.button}
          >
            <Text style={[styles.buttonText, { color: locked ? colors.inkSecondary : '#fff' }]}>
              {available ? 'Stop rides' : 'Start rides'}
            </Text>
          </LinearGradient>
        </Pressable>
      </View>
      <Pressable
        onPress={() => onChange(Boolean(dnd))}
        accessibilityRole="switch"
        accessibilityLabel="Off the clock"
        accessibilityHint="Do not disturb until you turn this off"
        accessibilityState={{ checked: dnd }}
        style={styles.switchRow}
      >
        <View style={styles.switchCopy}>
          <Text style={[styles.switchLabel, { color: colors.ink }]}>Off the clock</Text>
          <Text style={[styles.switchHint, { color: colors.inkSecondary }]}>Do not disturb until you turn this off</Text>
        </View>
        <View style={[styles.track, { backgroundColor: dnd ? colors.purple : colors.track }]}>
          <View style={[styles.knob, { marginLeft: dnd ? 20 : 2 }]} />
        </View>
      </Pressable>
      {available && onMinimize ? (
        <Pressable onPress={onMinimize} accessibilityRole="button" accessibilityLabel="Minimize ride controls">
          <Text style={[styles.switchHint, { color: colors.inkSecondary, textAlign: 'center' }]}>Minimize</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: 8 },
  compact: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: '#522D80',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  compactMain: { flex: 1, paddingVertical: 10, paddingHorizontal: 14 },
  compactText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  end: { backgroundColor: '#F56600', paddingHorizontal: 16, alignSelf: 'stretch', justifyContent: 'center' },
  endText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  buttonWrap: { justifyContent: 'center' },
  glow: {
    position: 'absolute',
    left: 4,
    right: 4,
    top: -3,
    bottom: -3,
    borderRadius: 999,
    backgroundColor: 'rgba(245,102,0,0.45)',
  },
  button: {
    minHeight: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonText: { fontSize: 17, fontWeight: '800' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchCopy: { flex: 1 },
  switchLabel: { fontWeight: '700', fontSize: 12 },
  switchHint: { fontSize: 11 },
  track: { width: 42, height: 24, borderRadius: 999, justifyContent: 'center' },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
})
