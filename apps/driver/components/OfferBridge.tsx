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
import { inAppRideAlert, isTripStatusPush, notifyNewRequest, notifyScheduledBoard, setRideAlertSurface } from '@/lib/push'
import { supabase } from '@/lib/supabase'
import { newRideAlertAllowed } from 'rides-native/offerAlertGate.js'
import { driverAlertPrefs } from '@/lib/quietHours'
import { useTheme } from '@/lib/theme'
import { GlassCard } from 'rides-native/glass'
import { GlassBadge } from 'rides-native/icons'
import { rideTypeIconName } from 'rides-native/rideTypeIcons.js'
import { acceptTrip, loadDriverDesk, markSearchingOffers, subscribeTrips } from 'rides-native/driverDesk'
import { clemsonMiamiDriverNotification } from 'rides-native/clemsonMiamiPromo.js'
import { isSyntheticOffer } from 'rides-native/syntheticOffers'
import { formatCents, type DriverCard } from 'rides-native/tripTags'
import { formatBoostBadge } from '../../../shared/scheduledBoost.js'
import { offerHourly, pickupMiles, EXCLUSIVE_SECONDS } from 'rides-native/offerLadder.js'
import { homeIsShowingOffer, offerAcceptSeconds } from 'rides-native/offerStack.js'
import { WorthItLegend } from 'rides-native/WorthItLegend'
import { shouldAutoAccept } from 'rides-native/autoAccept.js'
import { quiet } from '@/lib/softFail'

type Banner = {
  id: string
  title: string
  body: string
  tier: string
  offerExpiresAt: string | null
  offerPhase: string | null
  hourlyCents: number | null
}

export function OfferBridge() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors, autoAccept, scheme } = useTheme()
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

  function showBanner(card: DriverCard, driver?: { lat?: number | null; lng?: number | null } | null) {
    const promo = card.promoRide ? clemsonMiamiDriverNotification() : null
    const title = promo?.title || 'New ride request'
    const boostBit = (card.boostDriverCents || 0) > 0 ? ` · ${formatBoostBadge(card.boostDriverCents || 0)}` : ''
    const body = promo?.body || `${formatCents(card.driverNetCents)}${boostBit} · ${card.pickupLabel} → ${card.dropoffLabel}`
    const hourlyCents = offerHourly(card, driver && driver.lat != null && driver.lng != null ? { lat: driver.lat, lng: driver.lng } : undefined).hourlyCents
    setBanner({
      id: card.id,
      title,
      body,
      tier: card.tier || 'standard',
      offerExpiresAt: card.offerExpiresAt || null,
      offerPhase: card.offerPhase || null,
      hourlyCents,
    })
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

    // Notification prefs (quiet hours / DND / ride alerts) are shared with the web app.
    let prefs: unknown = null
    const loadPrefs = async () => {
      try {
        prefs = await driverAlertPrefs(user.id)
      } catch { /* keep the last prefs */ }
      return prefs
    }

    const look = async () => {
      try {
        const desk = await loadDriverDesk(supabase, user.id)
        const alertOk = newRideAlertAllowed({ online: Boolean(desk.online), prefs: await loadPrefs() })
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
            if (alertOk) notifyScheduledBoard(posted).catch(quiet('scheduled board alert'))
          }
        }
        const offers = (desk.offers || []).filter((card: DriverCard) => !isSyntheticOffer(card))
        if (desk.online) markSearchingOffers(supabase, offers).catch(quiet('mark searching offers'))
        if (!primed.current) {
          offers.forEach((card: DriverCard) => seen.current.add(card.id))
          primed.current = true
          return
        }
        const fresh = offers.filter((card: DriverCard) => !seen.current.has(card.id))
        fresh.forEach((card: DriverCard) => seen.current.add(card.id))
        const next = fresh[0]
        // Offline drivers get no new-ride notification at all.
        if (!next || !desk.online) return
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
          showBanner(next, driver)
          // Quiet hours / DND: the banner still shows, silently.
          if (alertOk) armPulse(next.tier || 'standard')
          return
        }
        if (!alertOk) return
        pulse('request', { tier: next.tier })
        notifyNewRequest(next).catch(quiet('new request alert'))
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
      // Arrived? / rider-canceled pushes are trip updates, not offers. The trip screen shows them.
      if (isTripStatusPush(content.data)) return
      const tripId = typeof content.data?.tripId === 'string' ? content.data.tripId : ''
      if (tripId && seen.current.has(tripId)) return
      if (tripId) seen.current.add(tripId)
      const tier = typeof content.data?.tier === 'string' ? content.data.tier : 'standard'
      const expiresAt = typeof content.data?.offerExpiresAt === 'string' ? content.data.offerExpiresAt : null
      const offerPhase = typeof content.data?.offerPhase === 'string' ? content.data.offerPhase : null
      setBanner({
        id: tripId || `push-${Date.now()}`,
        title: content.title || 'New ride request',
        body: content.body || 'Open the queue to respond.',
        tier,
        offerExpiresAt: expiresAt,
        offerPhase,
        hourlyCents: null,
      })
      if (newRideAlertAllowed({ online: true, prefs })) armPulse(tier)
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

  if (!banner || homeIsShowingOffer(banner.id)) return null
  const clock = offerAcceptSeconds({
    offerExpiresAt: banner.offerExpiresAt,
    offerPhase: banner.offerPhase,
  }, now)
  if (clock && clock.seconds <= 0) return null
  const leftLabel = clock
    ? (clock.kind === 'pool' ? `Pool · ${clock.seconds}s left` : `${clock.seconds}s to accept`)
    : null
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <Pressable
        onPress={() => {
          if (pulseStop.current) clearTimeout(pulseStop.current)
          stopRequestPulse()
          setBanner(null)
          router.push('/queue')
        }}
        accessibilityRole="button"
        accessibilityLabel={leftLabel ? `${banner.title}. ${banner.body}. ${leftLabel}.` : `${banner.title}. ${banner.body}.`}
        style={[styles.card, { backgroundColor: 'transparent', borderColor: colors.orange, overflow: 'hidden' }]}
      >
        <GlassCard app="driver" scheme={scheme} pointerEvents="none" selected style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <GlassBadge name={rideTypeIconName(banner.tier || 'standard')} size={32} tone="orange" scheme={scheme} active />
          <Text style={[styles.kicker, { color: colors.purple }]}>RIDE REQUEST</Text>
        </View>
        <Text style={[styles.title, { color: colors.title }]}>{banner.title}</Text>
        <Text style={{ color: colors.ink }}>{banner.body}</Text>
        {leftLabel ? <Text style={[styles.count, { color: colors.orange }]}>{leftLabel}</Text> : null}
        <WorthItLegend hourlyCents={banner.hourlyCents} colors={colors} />
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
