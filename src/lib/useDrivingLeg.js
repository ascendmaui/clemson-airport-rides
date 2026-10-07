import { useEffect, useRef, useState } from 'react'
import {
  drivingLegKey,
  fetchDrivingLeg,
  readDrivingLeg,
  rememberDrivingLeg,
  shouldRequestDrivingLeg,
} from './rideGeometry'

/**
 * One Directions leg per ~1 km of origin, and only when Maps JS is already
 * loaded. A miss does not retry once the service has answered.
 * `key` is the only dependency so a new array each render does not refetch.
 */
export function useDrivingLeg(origin, dest, enabled) {
  const key = enabled && shouldRequestDrivingLeg(origin, dest) ? drivingLegKey(origin, dest) : null
  const originRef = useRef(origin)
  const destRef = useRef(dest)
  originRef.current = origin
  destRef.current = dest
  const [slot, setSlot] = useState(() => {
    const cached = key ? readDrivingLeg(key) : null
    return cached ? { key, leg: cached } : null
  })

  useEffect(() => {
    if (!key) return undefined
    const from = originRef.current
    const to = destRef.current
    if (!from || !to) return undefined
    const cached = readDrivingLeg(key)
    if (cached) {
      setSlot({ key, leg: cached })
      return undefined
    }
    let alive = true
    let timer
    let tries = 0
    const run = () => {
      const ready = typeof window !== 'undefined' && window.google?.maps?.DirectionsService
      if (!ready) {
        if (tries < 8) {
          tries += 1
          timer = setTimeout(run, 400)
        }
        return
      }
      fetchDrivingLeg(from, to).then((next) => {
        if (!alive) return
        if (next?.path?.length > 1) {
          rememberDrivingLeg(key, next)
          setSlot({ key, leg: next })
        }
      })
    }
    run()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [key])

  return slot && slot.key === key ? slot.leg : null
}
