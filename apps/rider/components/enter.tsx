import { useEffect, useRef } from 'react'
import { Animated, Easing, type ViewStyle } from 'react-native'

/** Short fade-and-rise used on the rider home sheet and the request path. */
export function useEnterMotion(distance = 12) {
  const opacity = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(distance)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start()
  }, [opacity, translateY])

  return { opacity, transform: [{ translateY }] }
}

export function pressStyle(pressed: boolean, disabled = false): ViewStyle {
  return {
    opacity: disabled ? 0.55 : pressed ? 0.92 : 1,
    transform: [{ scale: pressed && !disabled ? 0.985 : 1 }],
  }
}
