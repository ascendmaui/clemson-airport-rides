import { uniqueChannelTopic } from '../../packages/rides-native/realtimeChannel.js'
import { useEffect, useState } from 'react'
import { RIDE_OPTIONS_POLL_MS } from '../../shared/rideOptions.js'
import { supabase } from './supabase.js'

export function useRideOptions({ scheduledFor = null } = {}) {
  const [snapshot, setSnapshot] = useState(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const params = new URLSearchParams({ action: 'ride-options' })
      if (scheduledFor) params.set('scheduled_for', scheduledFor)
      try {
        const res = await fetch(`/api/stripe-payment-methods?${params.toString()}`)
        const body = await res.json()
        if (alive) setSnapshot(body)
      } catch {
        if (alive) {
          setSnapshot({
            availableTierIds: [],
            catalog: [],
            empty: true,
            emptyMessage: 'No drivers available right now',
            schedulePath: 'schedule',
          })
        }
      }
    }
    load()
    const timer = setInterval(load, RIDE_OPTIONS_POLL_MS)
    let channel = null
    if (supabase) {
      channel = supabase
        .channel(uniqueChannelTopic(`ride-options-${scheduledFor || 'now'}`))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_status' }, () => { load() })
        .subscribe()
    }
    return () => {
      alive = false
      clearInterval(timer)
      if (channel && supabase) supabase.removeChannel(channel)
    }
  }, [scheduledFor])

  return snapshot
}
