/**
 * On-screen offer alerts for an approved driver, including after they leave Driver Home.
 * Uses the existing toast sender. Does not send email or a closed-app push.
 */
import { useEffect, useRef } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { pushToast } from '../lib/toasts'
import { isDueNow, isUnpaidAirportDepositTrip } from '../../packages/rides-native/tripTags.js'
import { offerVisibleToDriver, visibleOfferQuery } from '../../shared/driverOrder.js'

export function DriverOfferWatcher() {
  const { user } = useAuth()
  const seen = useRef(new Set())
  const primed = useRef(false)

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let alive = true
    primed.current = false
    seen.current = new Set()

    async function look() {
      if (!alive) return
      const app = await supabase
        .from('driver_applications')
        .select('onboarding_status')
        .eq('profile_id', user.id)
        .maybeSingle()
      if (!alive || app.error || app.data?.onboarding_status !== 'approved') return
      const presence = await supabase
        .from('driver_status')
        .select('online')
        .eq('driver_id', user.id)
        .maybeSingle()
      if (!alive || presence.error || !presence.data?.online) return
      const { data, error } = await visibleOfferQuery(supabase
        .from('trips')
        .select('id, status, rider_id, driver_id, pickup_label, dropoff_label, pickup_at, scheduled_for, deposit_cents, metadata, rider_note')
        .in('status', ['searching', 'offered']), user.id)
        .order('requested_at', { ascending: false })
        .limit(8)
      if (!alive || error) return
      const rows = (data || []).filter((row) => (
        offerVisibleToDriver(row, user.id)
        && isDueNow(row)
        && !isUnpaidAirportDepositTrip(row)
      ))
      if (!primed.current) {
        rows.forEach((row) => seen.current.add(row.id))
        primed.current = true
        return
      }
      rows.forEach((row) => {
        if (seen.current.has(row.id)) return
        seen.current.add(row.id)
        pushToast({
          kind: 'ride_requested',
          title: 'New ride offer',
          body: `${row.pickup_label || 'Pickup'} → ${row.dropoff_label || 'Drop-off'}`,
        })
      })
    }

    look()
    const channel = supabase
      .channel(`driver-offers-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => { look() })
      .subscribe()
    const poll = setInterval(look, 12000)
    return () => {
      alive = false
      clearInterval(poll)
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  return null
}
