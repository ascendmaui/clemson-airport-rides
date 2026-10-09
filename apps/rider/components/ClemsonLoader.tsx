import { useEffect, useRef } from 'react'
import { Animated, Easing, Text, View } from 'react-native'
import type { Palette } from '@/lib/palette'
import { useThemedStyles } from '@/lib/useThemedStyles'

const MARK = 84
const DISC = 68
const PAW = '#1A1033'

export function ClemsonLoader({ label = 'Finding a Tiger driver' }: { label?: string }) {
  const styles = useThemedStyles(makeStyles)
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
    <View
      style={styles.wrap}
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <View style={styles.mark}>
        <View style={styles.track} />
        <Animated.View style={[styles.ring, { transform: [{ rotate }] }]} />
        <View style={styles.core}>
          <PawMark />
        </View>
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  )
}

function PawMark() {
  return (
    <View style={paw.wrap}>
      <View style={paw.toes}>
        <View style={[paw.toe, paw.toeLeft]} />
        <View style={[paw.toe, paw.toeMid]} />
        <View style={[paw.toe, paw.toeMid]} />
        <View style={[paw.toe, paw.toeRight]} />
      </View>
      <View style={paw.pad} />
    </View>
  )
}

const paw = {
  wrap: { width: 40, height: 34, alignItems: 'center' as const, justifyContent: 'flex-end' as const },
  toes: { flexDirection: 'row' as const, alignItems: 'flex-end' as const, gap: 2, height: 18 },
  toe: { width: 8, height: 11, borderRadius: 4, backgroundColor: PAW },
  toeLeft: { transform: [{ rotate: '-24deg' }], marginBottom: 1 },
  toeMid: { marginBottom: 5 },
  toeRight: { transform: [{ rotate: '24deg' }], marginBottom: 1 },
  pad: {
    width: 22,
    height: 14,
    borderRadius: 8,
    backgroundColor: PAW,
    marginTop: 1,
  },
}

function makeStyles(colors: Palette) {
  return {
    wrap: { alignItems: 'center' as const, justifyContent: 'center' as const, gap: 12 },
    mark: {
      width: MARK,
      height: MARK,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    track: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      width: MARK,
      height: MARK,
      borderRadius: MARK / 2,
      borderWidth: 3,
      borderColor: colors.border,
    },
    ring: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      width: MARK,
      height: MARK,
      borderRadius: MARK / 2,
      borderWidth: 3,
      borderColor: 'transparent',
      borderTopColor: colors.purple,
      borderRightColor: colors.orange,
    },
    core: {
      width: DISC,
      height: DISC,
      borderRadius: DISC / 2,
      backgroundColor: colors.orange,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    label: {
      color: colors.ink,
      fontWeight: '700' as const,
      fontSize: 14,
      letterSpacing: -0.2,
      textAlign: 'center' as const,
    },
  }
}
