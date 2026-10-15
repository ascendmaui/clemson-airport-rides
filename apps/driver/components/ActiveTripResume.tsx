import { usePathname, useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { AccessibilityInfo } from 'react-native'
import { RESUMABLE_STATUSES, pickResumableTrip, resumeAnnouncement, shouldAutoResume } from 'rides-native/tripResume'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { takeTripResume } from '@/lib/crashReport'

// Module scope: resets on every app launch, so each live trip reopens once per launch.
const handled = new Set<string>()

/** On launch, reopen the driver's live trip instead of waiting for a tap on the Home card. */
export function ActiveTripResume() {
  const { user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const pathRef = useRef(pathname)
  pathRef.current = pathname

  // After a crash recovery ("Back to my trip"), reopen that trip once the stack is mounted.
  useEffect(() => {
    const tripId = takeTripResume()
    if (!tripId) return undefined
    handled.add(tripId)
    const timer = setTimeout(() => {
      try {
        router.push({ pathname: '/trip', params: { id: tripId } })
      } catch (err) {
        console.warn('[driver-crash] trip resume', err instanceof Error ? err.message : err)
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [router])

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let alive = true
    ;(async () => {
      const { data, error } = await supabase
        .from('trips')
        .select('id, status, pickup_at, scheduled_for, accepted_at')
        .eq('driver_id', user.id)
        .in('status', [...RESUMABLE_STATUSES])
        .order('accepted_at', { ascending: false })
        .limit(5)
      if (!alive || error) return
      const trip = pickResumableTrip(data || [])
      if (!trip) return
      if (!shouldAutoResume({ tripId: trip.id, pathname: pathRef.current, handled })) {
        handled.add(trip.id)
        return
      }
      handled.add(trip.id)
      router.push({ pathname: '/trip', params: { id: trip.id } })
      AccessibilityInfo.announceForAccessibility(resumeAnnouncement(trip.status))
    })().catch((err: unknown) => {
      // Not fatal: the Home card still links to the trip.
      console.warn('[trip resume]', err instanceof Error ? err.message : err)
    })
    return () => {
      alive = false
    }
  }, [router, user?.id])

  return null
}
