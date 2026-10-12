import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import type { ActionQueueEvent } from 'rides-native/actionQueue'
import { showToast } from 'rides-native/toastStore.js'
import { backOnlineMoment, chatMessageMoment, driverTipMoment, fareHoldStatus, paymentFailedMoment, type Moment } from 'rides-native/rideMoments.js'
import { useDriverActionQueue } from '@/lib/actionQueue'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { supabase } from '@/lib/supabase'

const COLS = 'id, status, pickup_label, dropoff_label, tip_cents, metadata'
type Snap = { tip: number; hold: string | null }

/**
 * Driver in-app feedback: tip received, a chat message while the app is
 * open, the rider's fare hold failing, and "Back online, N taps sent" after
 * the offline queue drains. Glass toast + haptic, plus a sound where it helps.
 */
export function DriverMoments() {
  const { user } = useAuth()
  const router = useRouter()
  const { pulse } = useFeedback()
  const seen = useRef(new Map<string, Snap>())
  const sentInBurst = useRef(0)
  const hadPending = useRef(false)

  const play = useCallback((moment: Moment, tripId?: string) => {
    showToast({
      key: moment.key,
      tone: moment.tone,
      title: moment.title,
      body: moment.body,
      onPress: tripId ? () => router.push({ pathname: '/trip', params: { id: tripId } }) : undefined,
    })
    switch (moment.cue) {
      case 'tip':
        pulse('accept') // Success haptic + the short accept chime (sounds toggle + mute switch apply)
        return
      case 'error':
        pulse('decline') // Error haptic, no sound
        return
      case 'chat':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
        return
      case 'online':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        return
      default:
        return
    }
  }, [pulse, router])

  // Offline queue: count taps that go through, confirm once the queue drains.
  const onQueueEvent = useCallback((event: ActionQueueEvent) => {
    if (event.type === 'sent') sentInBurst.current += 1
  }, [])
  const queue = useDriverActionQueue(onQueueEvent)
  useEffect(() => {
    if (queue.pending > 0) {
      hadPending.current = true
      return
    }
    if (!hadPending.current) return
    hadPending.current = false
    const moment = backOnlineMoment(sentInBurst.current)
    sentInBurst.current = 0
    if (moment) play(moment)
  }, [queue.pending, play])

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    const client = supabase
    let alive = true
    let primed = false
    seen.current = new Map()

    function onTrip(row: any) {
      if (!row?.id) return
      const next = { tip: Number(row.tip_cents) || 0, hold: fareHoldStatus(row) }
      const prev = seen.current.get(row.id)
      seen.current.set(row.id, next)
      if (!primed || !prev) return
      const tip = driverTipMoment(prev.tip, row)
      if (tip) play(tip, row.id)
      const hold = paymentFailedMoment(prev.hold, row, 'driver')
      if (hold) play(hold, row.id)
    }

    async function load() {
      const { data, error } = await client
        .from('trips')
        .select(COLS)
        .eq('driver_id', user!.id)
        .order('requested_at', { ascending: false })
        .limit(8)
      if (!alive || error) return
      ;(data || []).forEach(onTrip)
      primed = true
    }

    void load()
    const trips = client
      .channel(`driver-moments-${user.id}-${Date.now()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trips', filter: `driver_id=eq.${user.id}` }, (payload: { new: any }) => {
        if (primed) onTrip(payload.new)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trip_messages' }, (payload: { new: any }) => {
        // Foreground only: in the background the server push covers it.
        if (AppState.currentState !== 'active') return
        const moment = chatMessageMoment(payload.new, user.id)
        if (moment) play(moment, payload.new?.trip_id)
      })
      .subscribe()
    const timer = setInterval(() => { void load() }, 20000)
    return () => {
      alive = false
      clearInterval(timer)
      void client.removeChannel(trips)
    }
  }, [play, user?.id])

  return null
}
