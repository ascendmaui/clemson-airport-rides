import { useEffect, useState } from 'react'
import type { ResolvedMarker } from 'rides-native/driverDesk'

// Cosmetic only: the driver's chosen map marker, shared between the perks
// loader and the map. Never read by matching, ETA or pricing.
let current: ResolvedMarker | null = null
const listeners = new Set<(m: ResolvedMarker | null) => void>()

export function setMyMarker(marker: ResolvedMarker | null | undefined) {
  current = marker || null
  for (const fn of listeners) fn(current)
}

export function useMyMarker(): ResolvedMarker | null {
  const [m, setM] = useState(current)
  useEffect(() => {
    listeners.add(setM)
    return () => { listeners.delete(setM) }
  }, [])
  return m
}
