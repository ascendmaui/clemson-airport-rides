import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native'
import { useReduceMotion } from 'rides-native/shared/reduceMotion.js'
import { motion } from 'rides-native/shared/theme.js'

/**
 * Fade-and-rise used on rider sheets. Reduced motion snaps to the resting
 * state so the screen still appears, without the travel.
 */
export function Enter({
  children,
  token = 0,
  style,
}: {
  children: ReactNode
  token?: string | number
  style?: StyleProp<ViewStyle>
}) {
  const reduce = useReduceMotion()
  const opacity = useRef(new Animated.Value(0)).current
  const shift = useRef(new Animated.Value(motion.enterDistance)).current

  useEffect(() => {
    if (reduce) {
      opacity.setValue(1)
      shift.setValue(0)
      return undefined
    }
    opacity.setValue(0)
    shift.setValue(motion.enterDistance)
    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: motion.enterFadeMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(shift, {
        toValue: 0,
        duration: motion.enterRiseMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ])
    anim.start()
    return () => anim.stop()
  }, [opacity, reduce, shift, token])

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY: shift }] }, style]}>
      {children}
    </Animated.View>
  )
}
