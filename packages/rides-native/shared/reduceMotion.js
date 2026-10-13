import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/** True when the OS asks for reduced motion. Starts false until the OS answers. */
export function useReduceMotion() {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduce(Boolean(value))
    }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      setReduce(Boolean(value))
    })
    return () => {
      alive = false
      sub.remove()
    }
  }, [])
  return reduce
}
