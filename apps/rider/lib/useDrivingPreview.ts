import { useEffect, useState } from 'react'
import { authedJson } from 'rides-native/apiClient.js'
import {
  drivingLegFromQuote,
  quoteRouteBody,
  routePreview,
} from '../../../src/lib/rideGeometry.js'
import { supabase } from '@/lib/supabase'

export type DrivingPreview = {
  path: [number, number][]
  meters: number | null
  seconds: number | null
  etaLabel: string | null
  source: 'directions' | 'estimate'
}

export function useDrivingPreview(origin: [number, number] | null, dest: [number, number] | null) {
  const [preview, setPreview] = useState<DrivingPreview | null>(null)
  const key = origin && dest ? `${origin[0]},${origin[1]}|${dest[0]},${dest[1]}` : ''

  useEffect(() => {
    if (!origin || !dest) {
      setPreview(null)
      return undefined
    }
    let alive = true
    setPreview(routePreview(origin, dest))
    ;(async () => {
      try {
        const data = await authedJson(supabase, '/api/stripe-payment-methods?action=quote', {
          method: 'POST',
          body: quoteRouteBody(origin, dest),
        })
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
