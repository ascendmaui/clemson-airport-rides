import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export function useTeslaAvailability(enabled) {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const refresh = async () => {
      try {
        const result = await supabase?.rpc('tesla_fleet_available')
        if (alive) setAvailable(!result?.error && result?.data === true)
      } catch {
        if (alive) setAvailable(false)
      }
    }
    refresh()
    const timer = setInterval(refresh, 15000)
    return () => { alive = false; clearInterval(timer) }
  }, [enabled])
  return available
}
