import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native'
import { useReduceMotion } from 'rides-native/shared/reduceMotion.js'
import { motion } from 'rides-native/shared/theme.js'

/**
 * Rise used on driver pages. Liquid Glass must not animate to opacity 0,
 * so the entrance is a translate only. Reduced motion snaps to rest.
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
  const shift = useRef(new Animated.Value(motion.enterDistance)).current

  useEffect(() => {
    if (reduce) {
      shift.setValue(0)
      return undefined
    }
    shift.setValue(motion.enterDistance)
    const anim = Animated.timing(shift, {
      toValue: 0,
      duration: Math.max(motion.enterFadeMs, motion.enterRiseMs),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [reduce, shift, token])

  return (
    <Animated.View style={[{ transform: [{ translateY: shift }] }, style]}>
      {children}
    </Animated.View>
  )
}
