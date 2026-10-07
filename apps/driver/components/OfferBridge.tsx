/**
 * New-offer alerts.
 * Phone asleep, locked, or signed out: the server Expo push is the system toast.
 * App open and driver online: this banner, plus a pulsating chime for 15 seconds.
 */
import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { inAppRideAlert, notifyNewRequest, notifyScheduledBoard, setRideAlertSurface } from '@/lib/push'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { acceptTrip, loadDriverDesk, markSearchingOffers, subscribeTrips } from 'rides-native/driverDesk'
import { clemsonMiamiDriverNotification } from 'rides-native/clemsonMiamiPromo.js'
import { isSyntheticOffer } from 'rides-native/syntheticOffers'
import { formatCents, type DriverCard } from 'rides-native/tripTags'
import { offerHourly, pickupMiles, EXCLUSIVE_SECONDS } from 'rides-native/offerLadder.js'
import { shouldAutoAccept } from 'rides-native/autoAccept.js'

type Banner = {
  id: string
  title: string
  body: string
  tier: string
  shownAt: number
}

export function OfferBridge() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors, autoAccept } = useTheme()
  const { pulse, startRequestPulse, stopRequestPulse } = useFeedback()
  const seen = useRef(new Set<string>())
  const seenBoard = useRef(new Set<string>())
  const primed = useRef(false)
  const boardPrimed = useRef(false)
  const pulseStop = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [now, setNow] = useState(() => Date.now())

  function armPulse(tier: string) {
    startRequestPulse(tier)
    if (pulseStop.current) clearTimeout(pulseStop.current)
    pulseStop.current = setTimeout(() => stopRequestPulse(), EXCLUSIVE_SECONDS * 1000)
  }

  function showBanner(card: DriverCard) {
    const promo = card.promoRide ? clemsonMiamiDriverNotification() : null
    const title = promo?.title || 'New ride request'
    const body = promo?.body || `${formatCents(card.driverNetCents)} · ${card.pickupLabel} → ${card.dropoffLabel}`
    setBanner({ id: card.id, title, body, tier: card.tier || 'standard', shownAt: Date.now() })
    AccessibilityInfo.announceForAccessibility(`${title}. ${body}`)
  }

  useEffect(() => {
    if (!banner) return undefined
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [banner])

  useEffect(() => {
    if (!supabase || !user?.id) {
      setRideAlertSurface({ online: false })
      return undefined
    }
    let alive = true
    primed.current = false
    boardPrimed.current = false
    seen.current = new Set()
    seenBoard.current = new Set()

    const look = async () => {
      try {
        const desk = await loadDriverDesk(supabase, user.id)
        if (!alive) return
        setRideAlertSurface({ online: Boolean(desk.online) })
        const board = desk.scheduledOpen || []
        if (!boardPrimed.current) {
          board.forEach((card: DriverCard) => seenBoard.current.add(card.id))
          boardPrimed.current = true
        } else {
          const freshBoard = board.filter((card: DriverCard) => !seenBoard.current.has(card.id))
          freshBoard.forEach((card: DriverCard) => seenBoard.current.add(card.id))
          const posted = freshBoard[0]
          if (posted) {
            AccessibilityInfo.announceForAccessibility(`Scheduled ride on the board. ${posted.pickupLabel} to ${posted.dropoffLabel}`)
            notifyScheduledBoard(posted).catch(() => {})
          }
        }
        const offers = (desk.offers || []).filter((card: DriverCard) => !isSyntheticOffer(card))
        if (desk.online) markSearchingOffers(supabase, offers).catch(() => {})
        if (!primed.current) {
          offers.forEach((card: DriverCard) => seen.current.add(card.id))
          primed.current = true
          return
        }
        const fresh = offers.filter((card: DriverCard) => !seen.current.has(card.id))
        fresh.forEach((card: DriverCard) => seen.current.add(card.id))
        const next = fresh[0]
        if (!next || !desk.online) {
          if (next) notifyNewRequest(next).catch(() => {})
          return
        }
        const driver = { lat: desk.lat, lng: desk.lng }
        const decision = shouldAutoAccept({
          riderId: next.riderId,
          pickupMiles: pickupMiles(next, driver),
          hourlyCents: offerHourly(next, driver).hourlyCents,
        }, autoAccept)
        if (decision.accept) {
          try {
            await acceptTrip(supabase, next, user.id)
            stopRequestPulse()
            pulse('accept')
            router.push({ pathname: '/trip', params: { id: next.id } })
            return
          } catch {
            /* The offer is still on screen if another driver won it. */
          }
        }
        if (inAppRideAlert()) {
          showBanner(next)
          armPulse(next.tier || 'standard')
          return
        }
        pulse('request', { tier: next.tier })
        notifyNewRequest(next).catch(() => {})
      } catch {
        /* desk reads can fail while signed out or offline */
      }
    }

    look()
    const unsubscribe = subscribeTrips(supabase, () => { look() })
    const poll = setInterval(look, 12000)
    const received = Notifications.addNotificationReceivedListener((event: Notifications.Notification) => {
      if (!inAppRideAlert()) return
      const content = event.request.content
      const tripId = typeof content.data?.tripId === 'string' ? content.data.tripId : ''
      if (tripId && seen.current.has(tripId)) return
      if (tripId) seen.current.add(tripId)
      const tier = typeof content.data?.tier === 'string' ? content.data.tier : 'standard'
      setBanner({
        id: tripId || `push-${Date.now()}`,
        title: content.title || 'New ride request',
        body: content.body || 'Open the queue to respond.',
        tier,
        shownAt: Date.now(),
      })
      armPulse(tier)
    })
    return () => {
      alive = false
      unsubscribe()
      clearInterval(poll)
      received.remove()
      if (pulseStop.current) clearTimeout(pulseStop.current)
      stopRequestPulse()
    }
  }, [autoAccept, pulse, router, startRequestPulse, stopRequestPulse, user?.id])

  if (!banner) return null
  const left = Math.max(0, EXCLUSIVE_SECONDS - Math.floor((now - banner.shownAt) / 1000))
  if (left === 0 && now - banner.shownAt > EXCLUSIVE_SECONDS * 1000 + 400) return null
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <Pressable
        onPress={() => {
          setBanner(null)
          router.push('/queue')
        }}
        accessibilityRole="button"
        accessibilityLabel={`${banner.title}. ${banner.body}. ${left} seconds to accept.`}
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.orange }]}
      >
        <Text style={[styles.kicker, { color: colors.purple }]}>RIDE REQUEST</Text>
        <Text style={[styles.title, { color: colors.title }]}>{banner.title}</Text>
        <Text style={{ color: colors.ink }}>{banner.body}</Text>
        <Text style={[styles.count, { color: colors.orange }]}>{left}s to accept</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, zIndex: 30 },
  card: { borderRadius: 22, borderWidth: 2, padding: 14, gap: 4 },
  kicker: { fontWeight: '800', letterSpacing: 1, fontSize: 11 },
  title: { fontWeight: '800', fontSize: 18 },
  count: { fontWeight: '800', fontSize: 16 },
})
