import { useEffect, useRef } from 'react'
import { Animated, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/lib/theme'

export function Skeleton({
  height = 14,
  width = '100%',
  style,
}: {
  height?: number
  width?: number | `${number}%`
  style?: StyleProp<ViewStyle>
}) {
  const { colors } = useTheme()
  const opacity = useRef(new Animated.Value(0.45)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])

  return (
    <Animated.View
      style={[
        {
          height,
          width,
          borderRadius: 10,
          backgroundColor: colors.track,
          opacity,
        },
        style,
      ]}
    />
  )
}
