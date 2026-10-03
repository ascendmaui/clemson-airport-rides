import { useEffect, useRef } from 'react'
import { Animated, Easing, Text, View } from 'react-native'
import type { Palette } from '@/lib/palette'
import { useThemedStyles } from '@/lib/useThemedStyles'

export function ClemsonLoader({ label = 'Finding a Tiger driver' }: { label?: string }) {
  const styles = useThemedStyles(makeStyles)
  const spin = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(spin, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(420),
        Animated.timing(spin, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [spin])

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })

  return (
    <View style={styles.wrap} pointerEvents="none" accessibilityRole="progressbar">
      <View style={styles.ring} />
      <Animated.View style={[styles.core, { transform: [{ rotate }] }]}>
        <Text style={styles.paw}>🐾</Text>
      </Animated.View>
      <Text style={styles.label}>{label}</Text>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    wrap: { alignItems: 'center' as const, justifyContent: 'center' as const, gap: 10 },
    ring: {
      position: 'absolute' as const,
      top: 0,
      width: 84,
      height: 84,
      borderRadius: 42,
      borderWidth: 4,
      borderColor: 'transparent',
      borderTopColor: colors.purple,
      borderRightColor: colors.orange,
    },
    core: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.orange,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    paw: { fontSize: 28 },
    label: { marginTop: 78, color: colors.link, fontWeight: '800' as const, fontSize: 15 },
  }
}
