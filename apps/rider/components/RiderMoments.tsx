import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { showToast } from 'rides-native/toastStore.js'
import { paymentFailedMoment, riderTripMoment, riderTripSnapshot, type Moment, type RiderTripSnapshot } from 'rides-native/rideMoments.js'
import { afterRiderModal, riderModalIsOpen } from '@/lib/afterModal'
import { useAuth } from '@/lib/auth'
import { hapticsEnabled, playApproachPing, playCompleteCue, successHaptic, warningHaptic } from '@/lib/feedback'
import { supabase } from '@/lib/supabase'

const COLS = 'id, status, pickup_label, dropoff_label, metadata'

async function errorHaptic() {
  if (!(await hapticsEnabled())) return
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
}

/** Haptic + sound for a moment. Every part honors the rider's haptics / sounds settings and the mute switch. */
export function playRiderMoment(moment: Moment) {
  switch (moment.cue) {
    case 'arrived':
      void successHaptic()
      void playApproachPing()
      return
    case 'complete':
      void successHaptic()
      void playCompleteCue()
      return
    case 'canceled':
      void warningHaptic()
      return
    case 'error':
      void errorHaptic()
      return
    default:
      return
  }
}

/**
 * In-app feedback for the rider's key trip moments: driver arrived, trip
 * complete, driver canceled, and fare hold failed. One glass toast + cue per
 * moment; the first load only primes, so opening the app never replays old news.
 */
export function RiderMoments() {
  const { user } = useAuth()
  const router = useRouter()
  const seen = useRef(new Map<string, RiderTripSnapshot>())

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    const client = supabase
    let alive = true
    let primed = false
    seen.current = new Map()

    function onRow(row: any) {
      try {
        const next = riderTripSnapshot(row)
        if (!next) return
        const prev = seen.current.get(row.id) ?? null
        seen.current.set(row.id, next)
        if (!primed || !prev) return
        let failed: Moment | null = null
        try {
          failed = paymentFailedMoment(prev.hold, row, 'rider')
        } catch {
          failed = null
        }
        let tripMoment: Moment | null = null
        try {
          tripMoment = riderTripMoment(prev, row)
        } catch {
          tripMoment = null
        }
        const moments = [tripMoment, failed].filter(Boolean) as Moment[]
        const matched = ['accepted', 'arriving', 'arrived', 'in_progress'].includes(String(row.status || ''))
        for (const moment of moments) {
          // The match sheet already shows Add a payment method. A second banner
          // that navigates in the same tick fights that modal.
          if (moment.cue === 'error' && matched && riderModalIsOpen()) continue
          try {
            showToast({
              key: moment.key,
              tone: moment.tone,
              title: moment.title,
              body: moment.body,
              onPress: () => {
                try {
                  const href = moment.cue === 'error' || moment.action === 'billing'
                    ? { pathname: '/billing' as const }
                    : { pathname: '/requested' as const, params: { trip: row.id } }
                  afterRiderModal(() => router.push(href))
                } catch {
                  /* a hold failure must not crash the app */
                }
              },
            })
            playRiderMoment(moment)
          } catch {
            /* a bad moment must not crash the app */
          }
        }
      } catch {
        /* a null driver or a bad trip row must not crash the app */
      }
    }

    async function load() {
      const { data, error } = await client
        .from('trips')
        .select(COLS)
        .eq('rider_id', user!.id)
        .order('requested_at', { ascending: false })
        .limit(6)
      if (!alive || error) return
      ;(data || []).forEach(onRow)
      primed = true
    }

    void load()
    const channel = client
      .channel(`rider-moments-${user.id}-${Date.now()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trips', filter: `rider_id=eq.${user.id}` }, (payload: { new: any }) => {
        if (primed) onRow(payload.new)
      })
      .subscribe()
    const timer = setInterval(() => { void load() }, 20000)
    return () => {
      alive = false
      clearInterval(timer)
      void client.removeChannel(channel)
    }
  }, [router, user?.id])

  return null
}
