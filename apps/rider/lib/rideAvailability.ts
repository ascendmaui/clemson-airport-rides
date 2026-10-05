import { useCallback, useEffect, useState } from 'react'
import { authedJson } from 'rides-native/apiClient'
import {
  AVAILABILITY_POLL_MS,
  availabilityRequestBody,
  parseRideAvailability,
  RIDE_AVAILABILITY_PATH,
} from './rideAvailability.js'
import type { AppRideTier, RidePlaceInput, TierQuote } from './rideAvailability.js'

export {
  APP_RIDE_TIERS,
  AVAILABILITY_POLL_MS,
  availabilityRequestBody,
  isAppRideTier,
  parseRideAvailability,
  RIDE_AVAILABILITY_PATH,
} from './rideAvailability.js'

export type { AppRideTier, RidePlaceInput, TierQuote } from './rideAvailability.js'

export type AvailabilityStatus = 'loading' | 'ready' | 'error'

export function useRideAvailability(
  supabase: unknown,
  input: {
    scheduledFor?: string | null
    pickup?: RidePlaceInput | null
    dropoff?: RidePlaceInput | null
  },
  enabled: boolean,
) {
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<AvailabilityStatus>(enabled ? 'loading' : 'error')
  const [tiers, setTiers] = useState<AppRideTier[]>([])
  const [quotes, setQuotes] = useState<Partial<Record<AppRideTier, TierQuote>>>({})
  const scheduledFor = input.scheduledFor || ''
  const pickupKey = input.pickup ? `${input.pickup.label}:${input.pickup.lat}:${input.pickup.lng}` : ''
  const dropoffKey = input.dropoff ? `${input.dropoff.label}:${input.dropoff.lat}:${input.dropoff.lng}` : ''

  useEffect(() => {
    if (!enabled || !supabase) {
      setStatus('error')
      setTiers([])
      setQuotes({})
      return undefined
    }
    let alive = true
    const load = async () => {
      try {
        const data = await authedJson(supabase, RIDE_AVAILABILITY_PATH, {
          method: 'POST',
          body: availabilityRequestBody({
            scheduledFor: scheduledFor || null,
            pickup: input.pickup,
            dropoff: input.dropoff,
          }),
        })
        if (!alive) return
        const parsed = parseRideAvailability(data)
        setTiers(parsed.tiers)
        setQuotes(parsed.quotes)
        setStatus('ready')
      } catch {
        if (!alive) return
        setTiers([])
        setQuotes({})
        setStatus('error')
      }
    }
    void load()
    const timer = setInterval(() => { void load() }, AVAILABILITY_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [enabled, supabase, scheduledFor, pickupKey, dropoffKey, attempt, input.pickup, input.dropoff])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  return { status, tiers, quotes, retry }
}
