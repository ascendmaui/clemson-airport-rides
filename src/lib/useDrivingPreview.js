import { useEffect, useState } from 'react'
import {
  drivingLegFromQuote,
  fetchDrivingLeg,
  quoteRouteBody,
  routePreview,
} from './rideGeometry.js'

/**
 * Shows a straight-line preview immediately, then replaces it with the road
 * path from Maps JavaScript Directions or the existing quote/Routes call.
 */
export function useDrivingPreview(origin, dest) {
  const [preview, setPreview] = useState(null)
  const key = origin && dest ? `${origin[0]},${origin[1]}|${dest[0]},${dest[1]}` : ''

  useEffect(() => {
    if (!origin || !dest) {
      setPreview(null)
      return undefined
    }
    let alive = true
    setPreview(routePreview(origin, dest))
    ;(async () => {
      const mapsLeg = await fetchDrivingLeg(origin, dest)
      if (!alive) return
      if (mapsLeg?.path?.length) {
        setPreview(routePreview(origin, dest, mapsLeg))
        return
      }
      try {
        const res = await fetch('/api/stripe-payment-methods?action=quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(quoteRouteBody(origin, dest)),
        })
        if (!res.ok || !alive) return
        const data = await res.json()
        const serverLeg = drivingLegFromQuote(data)
        if (alive && serverLeg) setPreview(routePreview(origin, dest, serverLeg))
      } catch {
        /* The straight-line estimate stays until Directions is available. */
      }
    })()
    return () => {
      alive = false
    }
  }, [key])

  return preview
}
