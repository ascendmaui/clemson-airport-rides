import { useEffect, useRef } from 'react'
import { Animated, Easing, type ViewStyle } from 'react-native'
import { useReduceMotion } from 'rides-native/shared/reduceMotion.js'
import { motion } from 'rides-native/shared/theme.js'

/** Short rise used on the rider home sheet and the request path. Glass stays opaque. */
export function useEnterMotion(distance = motion.enterDistance) {
  const reduce = useReduceMotion()
  const translateY = useRef(new Animated.Value(reduce ? 0 : distance)).current

  useEffect(() => {
    if (reduce) {
      translateY.setValue(0)
      return undefined
    }
    translateY.setValue(distance)
    const anim = Animated.timing(translateY, {
      toValue: 0,
      duration: Math.max(motion.enterFadeMs, motion.enterRiseMs),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [distance, reduce, translateY])

  return { opacity: 1, transform: [{ translateY }] }
}

export function pressStyle(pressed: boolean, disabled = false): ViewStyle {
  return {
    opacity: disabled ? motion.disabledOpacity : pressed ? motion.pressOpacity : 1,
    transform: [{ scale: pressed && !disabled ? motion.pressScale : 1 }],
  }
}
