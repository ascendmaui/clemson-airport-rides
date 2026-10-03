import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'

const ORANGE = '#F56600'
const SIZE = 220

function Ring({ delay }: { delay: number }) {
  const progress = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(progress, {
          toValue: 1,
          duration: 3200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(progress, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [delay, progress])
  return (
    <Animated.View
      style={[
        styles.ring,
        {
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.28, 1] }) }],
        },
      ]}
    />
  )
}

/** Subtle radar on the driver map while they are on the clock looking for offers. */
export function LookingRadar() {
  const sweep = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 4200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [sweep])
  const spin = sweep.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
  return (
    <View pointerEvents="none" style={styles.wrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Ring delay={0} />
      <Ring delay={1050} />
      <Ring delay={2100} />
      <Animated.View style={[styles.sweep, { transform: [{ rotate: spin }] }]} />
      <View style={styles.core} />
      <Text style={styles.label}>Looking for rides</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: '50%',
    top: '36%',
    width: SIZE,
    height: SIZE,
    marginLeft: -SIZE / 2,
    marginTop: -SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 1.5,
    borderColor: 'rgba(245,102,0,0.55)',
  },
  sweep: {
    position: 'absolute',
    width: SIZE - 56,
    height: SIZE - 56,
    borderRadius: (SIZE - 56) / 2,
    borderWidth: 14,
    borderColor: 'transparent',
    borderTopColor: 'rgba(245,102,0,0.45)',
  },
  core: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: ORANGE,
  },
  label: {
    position: 'absolute',
    top: SIZE + 6,
    color: ORANGE,
    fontWeight: '700',
    fontSize: 13,
  },
})
