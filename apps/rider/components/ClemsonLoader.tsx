import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { ORANGE, PURPLE } from 'rides-native/places.js'

export function ClemsonLoader({ label = 'Finding a Tiger driver' }: { label?: string }) {
  const spin = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [spin])

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })

  return (
    <View style={styles.wrap} pointerEvents="none" accessibilityRole="progressbar">
      <Animated.View style={[styles.ring, { transform: [{ rotate }] }]} />
      <View style={styles.core}>
        <Text style={styles.paw}>🐾</Text>
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  ring: {
    position: 'absolute',
    top: 0,
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 4,
    borderColor: 'transparent',
    borderTopColor: PURPLE,
    borderRightColor: ORANGE,
  },
  core: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paw: { fontSize: 28 },
  label: { marginTop: 78, color: PURPLE, fontWeight: '800', fontSize: 15 },
})
