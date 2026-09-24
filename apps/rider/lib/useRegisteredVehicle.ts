import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { loadRegisteredVehicle, type RegisteredVehicle } from 'rides-native/shared/vehicle.js'

export function useRegisteredVehicle(userId?: string) {
  const [vehicle, setVehicle] = useState<RegisteredVehicle | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!userId) {
      setVehicle(null)
      setError(null)
      setLoaded(true)
      return
    }
    if (!supabase) {
      setVehicle(null)
      setError('Supabase is not configured')
      setLoaded(true)
      return
    }
    try {
      const row = await loadRegisteredVehicle(supabase, userId)
      setVehicle(row)
      setError(null)
    } catch (err) {
      setVehicle(null)
      setError(err instanceof Error ? err.message : 'Could not load your vehicle')
    } finally {
      setLoaded(true)
    }
  }, [userId])

  useEffect(() => {
    setLoaded(false)
    void reload()
  }, [reload])

  return { vehicle, loaded, error, reload }
}
