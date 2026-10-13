import { useEffect, useRef } from 'react'
import { Animated, Easing, type ViewStyle } from 'react-native'
import { useReduceMotion } from 'rides-native/shared/reduceMotion.js'
import { motion } from 'rides-native/shared/theme.js'

/** Short fade-and-rise used on the rider home sheet and the request path. */
export function useEnterMotion(distance = motion.enterDistance) {
  const reduce = useReduceMotion()
  const opacity = useRef(new Animated.Value(reduce ? 1 : 0)).current
  const translateY = useRef(new Animated.Value(reduce ? 0 : distance)).current

  useEffect(() => {
    if (reduce) {
      opacity.setValue(1)
      translateY.setValue(0)
      return undefined
    }
    opacity.setValue(0)
    translateY.setValue(distance)
    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: motion.enterFadeMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: motion.enterRiseMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ])
    anim.start()
    return () => anim.stop()
  }, [distance, opacity, reduce, translateY])

  return { opacity, transform: [{ translateY }] }
}

export function pressStyle(pressed: boolean, disabled = false): ViewStyle {
  return {
    opacity: disabled ? motion.disabledOpacity : pressed ? motion.pressOpacity : 1,
    transform: [{ scale: pressed && !disabled ? motion.pressScale : 1 }],
  }
}
