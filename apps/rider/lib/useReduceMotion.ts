import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/** True when the system asks for fewer automatic transitions. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduce(value)
      })
      .catch(() => {})
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce)
    return () => {
      alive = false
      sub.remove()
    }
  }, [])
  return reduce
}
