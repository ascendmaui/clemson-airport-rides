import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CampusMap, type MapPin } from '@/components/CampusMap'
import { FarePanel } from '@/components/FarePanel'
import { Card, ErrorText, Primary, Tag, useCardShadow } from '@/components/chrome'
import { CircleButton, GoButton } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { notifyNewRequest } from '@/lib/push'
import { shownCents } from '@/lib/shown'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { useDriverLocation } from '@/lib/useDriverLocation'
import { fetchDriverApplication, setDriverOnline } from 'rides-native/drivers'
import { displayFirstName } from 'rides-native/authErrors'
import { heatColor } from 'rides-native/heat.js'
import { HEAT_WINDOWS } from 'rides-native/places.js'
import { loadBusySpots, type BusySpot } from '@/lib/busySpots'
import {
  acceptTrip,
  declineTrip,
  formatCents,
  loadDriverDesk,
  loadGameDay,
  loadEarnings,
  publishDriverCapacity,
  publishDriverLocation,
  setPriorityMode,
  subscribeTrips,
  type DriverDesk,
} from 'rides-native/driverDesk'
import { CUPD_PHONE_DISPLAY, CUPD_PHONE_E164 } from 'rides-native/safety.js'
import {
  acceptActionLabel,
  declineActionLabel,
  declineDisposition,
  formatPickupAt,
  preferredRequestNote,
  statusHeadline,
  tagTone,
  TESLA_FLEET_NOTICE,
  weekNetCents,
  type DriverCard,
} from 'rides-native/tripTags'
import { etaHoldLine, etaLineFor } from 'rides-native/liveTrip'
import { ORANGE, PURPLE } from 'rides-native/places.js'
import { gameDayNotice, type GameDayNotice } from 'rides-native/gameDayNotice.js'
import { approvalGateMessage, isSyntheticOffer, syntheticOffers } from 'rides-native/syntheticOffers'
import { loadCounterpart } from 'rides-native/partyProfile.js'
import { offerCardViewModel } from 'rides-native/offerCard'

const GATE: Record<string, { title: string; body: string }> = {
  pending_info: {
    title: 'Finish driver signup',
    body: 'Add your info, vehicle, documents, W-9, and contractor agreement. New drivers are not approved automatically.',
  },
  pending_docs: {
    title: 'Finish your application',
    body: 'License, insurance, registration, and car photos come before you submit. You can keep setting up the account after that.',
  },
  pending_review: {
    title: 'Application under review',
    body: 'Application under review — you can set up your account, but you can’t accept rides yet.',
  },
  rejected: {
    title: 'Application needs changes',
    body: 'Update the flagged steps and submit again. You still cannot receive rides.',
  },
  none: {
    title: 'Become a driver',
    body: 'For Clemson University students — and for drivers already on Uber or Lyft.',
  },
}

/** Home map overlay grid: screen-edge gutter, spacing between floating pieces, clearance under the status bar. */
const EDGE = 16
const GAP = 12
const TOP_MARGIN = 8

function demandWord(intensity: number): string {
  if (intensity >= 0.75) return 'Busy'
  if (intensity >= 0.45) return 'Picking up'
  if (intensity >= 0.22) return 'Light'
  return 'Quiet'
}

export default function DriverHome() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors, scheme, earningsPrivate, setEarningsPrivate } = useTheme()
  const shadow = useCardShadow()
  const { user, configured } = useAuth()
  const { pulse } = useFeedback()
  const seenOffers = useRef(new Set<string>())
  const offersPrimed = useRef(false)
  const [desk, setDesk] = useState<DriverDesk | null>(null)
  const [todayCents, setTodayCents] = useState(0)
  const [weekCents, setWeekCents] = useState(0)
  const [lastTrip, setLastTrip] = useState<string | null>(null)
  const [status, setStatus] = useState('none')
  const [reason, setReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [self, setSelf] = useState<{ latitude: number; longitude: number } | null>(null)
  const [peek, setPeek] = useState(false)
  const [peekPage, setPeekPage] = useState(0)
  const [safetyOpen, setSafetyOpen] = useState(false)
  const [focusToken, setFocusToken] = useState(0)
  const [showHeat, setShowHeat] = useState(true)
  const [heatWindow, setHeatWindow] = useState('now')
  const [spots, setSpots] = useState<BusySpot[]>([])
  const [heatCaption, setHeatCaption] = useState('Popular campus spots from ride requests.')
  const [heatBlended, setHeatBlended] = useState(false)
  const [heatLoading, setHeatLoading] = useState(true)
  const [riderLine, setRiderLine] = useState<string | null>(null)
  const [hiddenOffers, setHiddenOffers] = useState<string[]>([])
  const [gameNotice, setGameNotice] = useState<GameDayNotice | null>(null)
  const approved = status === 'approved'
  const pendingReview = status === 'pending_review'
  const online = Boolean(desk?.online)
  const name = user ? displayFirstName(user.user_metadata?.full_name || user.email?.split('@')[0], 'Driver') : 'Driver'
  const tabClearance = insets.bottom + 72
  // The dock is pinned between the status bar / Dynamic Island and the tab bar.
  // Its content stacks from the bottom; an offer card shrinks (and scrolls) to fit.
  const dockTop = insets.top + TOP_MARGIN

  useEffect(() => {
    if (!supabase) {
      setGameNotice(gameDayNotice(null))
      return undefined
    }
    let alive = true
    loadGameDay(supabase).then((row) => {
      if (alive) setGameNotice(gameDayNotice(row))
    }).catch(() => {
      if (alive) setGameNotice(gameDayNotice(null))
    })
    return () => {
      alive = false
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const application = await fetchDriverApplication(supabase, user.id)
    const nextStatus = application.application?.onboarding_status || 'none'
    setStatus(nextStatus)
    setReason(application.application?.rejection_reason || null)
    if (application.error) setError(application.error)
    if (nextStatus === 'approved' || nextStatus === 'pending_review') {
      const loaded = await loadDriverDesk(supabase, user.id)
      setDesk(loaded)
      if (loaded.lat != null && loaded.lng != null) {
        setSelf({ latitude: Number(loaded.lat), longitude: Number(loaded.lng) })
      }
      const earnings = await loadEarnings(supabase, user.id).catch(() => null)
      if (earnings) {
        setTodayCents(earnings.summary?.todayNetCents || 0)
        setWeekCents(weekNetCents(earnings.trips || []))
        const latest = earnings.trips?.[0]
        setLastTrip(latest?.dropoff_label || latest?.pickup_label || null)
      }
    }
  }, [user])

  useEffect(() => {
    const active = desk?.active
    if (!supabase || !user || !active?.riderId) {
      setRiderLine(null)
      return undefined
    }
    let alive = true
    loadCounterpart(supabase, {
      status: active.status,
      rider_id: active.riderId,
      driver_id: user.id,
    }, user.id).then((person) => {
      if (alive) setRiderLine(person ? `${person.name} · ${person.ratingLine}` : null)
    }).catch(() => {
      if (alive) setRiderLine(null)
    })
    return () => {
      alive = false
    }
  }, [desk?.active?.id, desk?.active?.status, desk?.active?.riderId, user])

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load driver home'))
  }, [refresh])

  useEffect(() => {
    if (!supabase || (!approved && !pendingReview)) return undefined
    return subscribeTrips(supabase, () => {
      refresh().catch(() => {})
    })
  }, [approved, pendingReview, refresh])

  useEffect(() => {
    const offers = desk?.offers || []
    if (!offersPrimed.current) {
      offers.forEach((card) => seenOffers.current.add(card.id))
      offersPrimed.current = true
      return
    }
    const fresh = offers.filter((card) => !seenOffers.current.has(card.id) && !isSyntheticOffer(card))
    fresh.forEach((card) => seenOffers.current.add(card.id))
    const next = fresh[0]
    if (!next) return
    pulse('request')
    notifyNewRequest(next).catch(() => {})
  }, [desk?.offers, pulse])

  useEffect(() => {
    let alive = true
    setHeatLoading(true)
    loadBusySpots(heatWindow)
      .then((result) => {
        if (!alive) return
        setSpots(result.spots)
        setHeatCaption(result.caption)
        setHeatBlended(result.blended)
      })
      .catch(() => {
        if (!alive) return
        setSpots([])
        setHeatCaption('Could not load campus demand.')
        setHeatBlended(false)
      })
      .finally(() => {
        if (alive) setHeatLoading(false)
      })
    return () => {
      alive = false
    }
  }, [heatWindow])

  useDriverLocation(Boolean(user && approved && online), (fix) => {
    setSelf({ latitude: fix.lat, longitude: fix.lng })
    if (!supabase || !user) return
    publishDriverLocation(supabase, user.id, { ...fix, online: true }).catch(() => {})
  })

  async function toggle() {
    if (!user) {
      router.push('/sign-in')
      return
    }
    if (pendingReview) {
      setError(approvalGateMessage())
      return
    }
    if (!approved) {
      router.push('/onboarding')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const nextOnline = !online
      await setDriverOnline(supabase, user.id, nextOnline)
      if (nextOnline) await publishDriverCapacity(supabase, user.id, desk?.vehicle?.seats)
      pulse('online')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update online status')
    } finally {
      setBusy(false)
    }
  }

  async function onAccept(card: DriverCard) {
    if (!user || !supabase) return
    if (!approved || isSyntheticOffer(card)) {
      setError(approvalGateMessage())
      return
    }
    setBusy(true)
    setError(null)
    try {
      await acceptTrip(supabase, card, user.id)
      pulse('accept')
      await refresh()
      router.push({ pathname: '/trip', params: { id: card.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept')
    } finally {
      setBusy(false)
    }
  }

  async function onDecline(card: DriverCard) {
    if (isSyntheticOffer(card)) {
      setHiddenOffers((current) => (current.includes(card.id) ? current : [...current, card.id]))
      return
    }
    if (!supabase || !user) return
    setBusy(true)
    setError(null)
    try {
      await declineTrip(supabase, card, user.id)
      pulse('decline')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not decline')
    } finally {
      setBusy(false)
    }
  }

  async function onPriority() {
    if (!user || !supabase || !desk) return
    try {
      await setPriorityMode(supabase, user.id, !desk.priority)
      setDesk({ ...desk, priority: !desk.priority })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update priority')
    }
  }

  const gate = GATE[status] || GATE.none
  const synthetic = pendingReview
    ? syntheticOffers().filter((card) => !hiddenOffers.includes(card.id))
    : []
  const offer = (approved ? desk?.offers[0] : null) || synthetic[0] || null
  const liveFrom = self
    ? { lat: self.latitude, lng: self.longitude }
    : desk?.lat != null && desk?.lng != null
      ? { lat: Number(desk.lat), lng: Number(desk.lng) }
      : null
  const liveEta = desk?.active
    ? etaHoldLine(desk.active.status, etaLineFor(desk.active.status, liveFrom, desk.active))
    : null
  const hotspots = spots.slice().sort((a, b) => b.intensity - a.intensity).slice(0, 4)
  const pins: MapPin[] = []
  if (self) pins.push({ id: 'me', ...self, title: 'You', pinColor: ORANGE })
  if (offer?.pickupLat != null && offer.pickupLng != null) {
    pins.push({ id: 'pickup', latitude: offer.pickupLat, longitude: offer.pickupLng, title: 'Pickup', pinColor: PURPLE })
  }
  // When heat is on, circles carry demand — keep pins to you + pickup only.
  if (!showHeat) {
    hotspots.forEach((spot) => {
      pins.push({
        id: spot.id,
        latitude: spot.lat,
        longitude: spot.lng,
        title: `${spot.name} · ${demandWord(spot.intensity)}`,
        pinColor: heatColor(spot.intensity),
      })
    })
  }



  const statusLine = !user
    ? 'Sign in to drive'
    : pendingReview
      ? 'Under review'
      : !approved
        ? 'Finish signup'
        : online
          ? `You're online, ${name}`
          : 'You\'re offline'

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <CampusMap
        pins={pins}
        center={self}
        colorScheme={scheme}
        focusToken={focusToken}
        spots={spots}
        showHeat={showHeat}
        gameDay={Boolean(gameNotice?.live)}
        gameDayLabel={gameNotice?.live ? gameNotice.headline : null}
      />
      <View pointerEvents="box-none" style={styles.overlay}>
        <View style={[styles.top, { paddingTop: dockTop }]} pointerEvents="box-none">
          <CircleButton icon="home" label="Menu" onPress={() => router.push('/menu')} />
          <Pressable
            onPress={() => setPeek((open) => !open)}
            style={[styles.pill, shadow, { backgroundColor: colors.card }]}
            accessibilityRole="button"
            accessibilityLabel="Earnings"
          >
            <Text style={[styles.pillText, { color: colors.title }]}>{shownCents(todayCents, earningsPrivate)}</Text>
            <Text style={{ color: colors.inkSecondary, fontWeight: '800' }}>{peek ? '▴' : '▾'}</Text>
          </Pressable>
          <CircleButton icon="search" label="Discover" onPress={() => router.push('/discover')} />
        </View>

        {peek ? (
          <View style={[styles.peek, shadow, { backgroundColor: colors.card }]}>
            <View style={styles.peekHead}>
              <Pressable onPress={() => setEarningsPrivate(!earningsPrivate)} accessibilityLabel="Hide earnings">
                <Text style={{ color: colors.title, fontWeight: '800' }}>{earningsPrivate ? 'Show' : 'Hide'}</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/learning')} accessibilityLabel="Help">
                <Text style={{ color: colors.orange, fontWeight: '800' }}>Help</Text>
              </Pressable>
            </View>
            <Text style={[styles.peekAmount, { color: colors.title }]}>
              {shownCents(peekPage === 0 ? todayCents : weekCents, earningsPrivate)}
            </Text>
            <Text style={{ color: colors.inkSecondary }}>{peekPage === 0 ? 'Today' : 'This week'}</Text>
            <Text style={{ color: colors.ink, fontWeight: '700' }}>
              {lastTrip ? `Last trip · ${lastTrip}` : 'No completed trip yet'}
            </Text>
            <Primary label="See earnings activity" onPress={() => router.push('/earnings-activity')} tone="purple" />
            <View style={styles.dots}>
              {[0, 1].map((page) => (
                <Pressable key={page} onPress={() => setPeekPage(page)} style={[styles.dot, { backgroundColor: page === peekPage ? colors.orange : colors.track }]} />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.heatPanel}>
          <View style={styles.heatRow}>
            <Text style={[styles.heatLabel, { color: colors.inkSecondary }]}>Busy areas</Text>
            <Pressable
              onPress={() => setShowHeat((value) => !value)}
              style={[styles.heatToggle, { backgroundColor: showHeat ? colors.orange : colors.card }]}
              accessibilityRole="button"
              accessibilityLabel={showHeat ? 'Hide busy areas' : 'Show busy areas'}
            >
              <Text style={{ color: showHeat ? '#fff' : colors.title, fontWeight: '800', fontSize: 12 }}>
                {showHeat ? 'On' : 'Off'}
              </Text>
            </Pressable>
          </View>
          {showHeat ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.heatWindows}>
              {HEAT_WINDOWS.map((item) => {
                const on = item.id === heatWindow
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setHeatWindow(item.id)}
                    style={[styles.heatChip, { backgroundColor: on ? colors.orange : colors.card }]}
                  >
                    <Text style={{ color: on ? '#fff' : colors.title, fontWeight: '800', fontSize: 12 }}>{item.label}</Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          ) : null}
          <Text style={{ color: colors.inkSecondary, fontSize: 12, marginHorizontal: 16, marginTop: 6 }}>
            {heatLoading ? 'Loading campus demand…' : showHeat ? `${heatCaption}${heatBlended ? ' · Live + typical' : ''}` : 'Busy areas are hidden.'}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hotspots} style={styles.hotspotRow}>
            <View style={[styles.hotspot, { backgroundColor: gameNotice?.live ? colors.orange : colors.card }]}>
              <Text style={[gameNotice?.live ? styles.hotspotOn : styles.hotspotOff, gameNotice?.live ? null : { color: colors.purple }]}>
                {gameNotice == null ? 'Game day…' : gameNotice.headline}
              </Text>
            </View>
            {hotspots.map((spot) => (
              <View key={spot.id} style={[styles.hotspot, { backgroundColor: colors.card }, shadow]}>
                <Text style={{ color: colors.title, fontWeight: '800' }}>{spot.name}</Text>
                <Text style={{ color: colors.orange, fontWeight: '700', fontSize: 12 }}>{demandWord(spot.intensity)}</Text>
              </View>
            ))}
          </ScrollView>
          {gameNotice ? (
            <Text style={{ color: colors.inkSecondary, fontSize: 12, marginHorizontal: 16, marginTop: 6 }}>
              {gameNotice.live ? `${gameNotice.detail}. ${gameNotice.body}` : gameNotice.body}
            </Text>
          ) : null}
        </View>

        <View style={styles.flex} pointerEvents="box-none" />

        <View pointerEvents="box-none" style={[styles.dock, { top: dockTop, bottom: tabClearance }]}>
          {!configured ? <ErrorText>Add EXPO_PUBLIC_SUPABASE_ANON_KEY as an EAS environment variable, then rebuild.</ErrorText> : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          {user && pendingReview && !offer ? (
            <Card>
              <Text style={[styles.cardTitle, { color: colors.title }]}>{gate.title}</Text>
              <Text style={{ color: colors.inkSecondary }}>{gate.body}</Text>
            </Card>
          ) : null}
          {user && !approved && !pendingReview ? (
            <Card>
              <Text style={[styles.cardTitle, { color: colors.title }]}>{gate.title}</Text>
              <Text style={{ color: colors.inkSecondary }}>{gate.body}</Text>
              {reason ? <ErrorText>{reason}</ErrorText> : null}
              <Primary label={status === 'none' ? 'Become a driver' : 'Continue application'} onPress={() => router.push(user ? '/onboarding' : '/sign-in')} />
            </Card>
          ) : null}
          {desk?.active ? (
            <Pressable onPress={() => router.push({ pathname: '/trip', params: { id: desk.active!.id } })} style={[styles.live, { backgroundColor: colors.fill }]}>
              <Text style={[styles.liveKicker, { color: colors.orange }]}>LIVE TRIP</Text>
              <Text style={[styles.liveTitle, { color: colors.onAccent }]}>{statusHeadline(desk.active.status)}</Text>
              <Text style={{ color: colors.onAccent }}>{desk.active.pickupLabel} → {desk.active.dropoffLabel}</Text>
              {liveEta ? <Text style={{ color: colors.orange, fontWeight: '800' }}>{liveEta}</Text> : null}
              {riderLine ? <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{riderLine}</Text> : null}
            </Pressable>
          ) : null}
          {offer && !desk?.active ? (
            <RideCard
              card={offer}
              busy={busy}
              notice={user && pendingReview ? gate.body : null}
              onAccept={() => onAccept(offer)}
              onDecline={() => onDecline(offer)}
            />
          ) : null}
          <View style={styles.controls} pointerEvents="box-none">
            <View style={styles.toolCol}>
              <CircleButton icon="shield" label="Safety" onPress={() => setSafetyOpen(true)} />
              <CircleButton icon="sparkles" label="Priority mode" onPress={onPriority} />
            </View>
            <GoButton online={online} busy={busy} onPress={toggle} />
            <View style={styles.toolCol}>
              <CircleButton icon="stats-chart" label="Earnings" onPress={() => router.push('/earnings')} />
              <CircleButton icon="locate" label="Recenter map" onPress={() => setFocusToken((value) => value + 1)} />
            </View>
          </View>
          <View style={[styles.bar, shadow, { backgroundColor: colors.card }]}>
            <CircleButton icon="options" label="Ride queue" onPress={() => router.push('/queue')} />
            <Text style={[styles.barText, { color: colors.title }]}>{statusLine}</Text>
            <CircleButton icon="list" label="Open queue" onPress={() => router.push('/queue')} />
          </View>
        </View>
      </View>
      <Modal visible={safetyOpen} transparent animationType="slide" onRequestClose={() => setSafetyOpen(false)}>
        <Pressable style={styles.modalScrim} onPress={() => setSafetyOpen(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.card }]} onPress={() => {}}>
            <Text style={[styles.cardTitle, { color: colors.title }]}>Safety</Text>
            <Text style={{ color: colors.inkSecondary }}>
              Clemson University Police are {CUPD_PHONE_DISPLAY}. If you are in danger, call 911.
            </Text>
            <Primary label="Call 911" onPress={() => Linking.openURL('tel:911')} />
            <Primary label={`Call CUPD ${CUPD_PHONE_DISPLAY}`} onPress={() => Linking.openURL(`tel:${CUPD_PHONE_E164}`)} tone="purple" />
            <Primary label="Close" onPress={() => setSafetyOpen(false)} tone="ghost" />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

function RideCard({
  card,
  busy,
  notice,
  onAccept,
  onDecline,
}: {
  card: DriverCard
  busy: boolean
  notice?: string | null
  onAccept: () => void
  onDecline: () => void
}) {
  const { colors } = useTheme()
  const vm = offerCardViewModel(card)
  const preferredNote = preferredRequestNote(card)
  const opacity = useState(() => new Animated.Value(0))[0]
  const scrollRef = useRef<ScrollView>(null)
  const [viewport, setViewport] = useState(0)
  const [content, setContent] = useState(0)
  const overflows = viewport > 0 && content > viewport + 1
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }).start()
  }, [opacity])
  useEffect(() => {
    // Hint that the breakdown scrolls when the card had to shrink to fit.
    if (overflows) scrollRef.current?.flashScrollIndicators()
  }, [overflows, card.id])
  return (
    // flexShrink lets the dock squeeze the card to the room left above the controls;
    // only the details scroll — Accept / Decline stay pinned and visible.
    <Animated.View style={[styles.offerWrap, { opacity }]}>
      <Card
        style={styles.offerCard}
        accessibilityRole="summary"
        accessibilityLabel={vm.accessibilityLabel}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.offerScroll}
          contentContainerStyle={styles.offerBody}
          showsVerticalScrollIndicator={overflows}
          bounces={overflows}
          scrollEnabled={overflows}
          onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
          onContentSizeChange={(_, height) => setContent(height)}
        >
          {notice ? <Text style={[styles.offerNotice, { color: colors.orange }]}>{notice}</Text> : null}
          <View style={styles.offerFareRow}>
            <Text style={[styles.offerFare, { color: colors.ink }]} accessibilityLabel={`Driver net pay ${vm.pay.formattedNet}`}>
              {vm.pay.formattedNet}
            </Text>
            <Text style={[styles.offerFareTag, { color: colors.inkSecondary }]}>net</Text>
          </View>
          <Text style={{ color: colors.inkSecondary }}>
            {vm.pay.subtext}
          </Text>
          {vm.badges.length > 0 ? (
            <View style={styles.tags}>
              {vm.badges.map((b) => (
                <Tag key={b.id} label={b.label} tone={b.tone} />
              ))}
            </View>
          ) : null}
          {preferredNote ? <Text style={{ color: colors.orange, fontWeight: '700' }}>{preferredNote}</Text> : null}
          <Text style={{ color: colors.ink, fontWeight: '700' }}>
            {vm.rider.firstName}
            {vm.rider.ratingText ? ` · ${vm.rider.ratingText}` : ''}
            {vm.rider.rideType ? ` · ${vm.rider.rideType}` : ''}
            {vm.seats.seatsLabel ? ` · ${vm.seats.seatsLabel}` : ''}
          </Text>
          <Text style={{ color: colors.ink, fontWeight: '700' }}>Pickup · {card.pickupLabel}</Text>
          <Text style={{ color: colors.ink, fontWeight: '700' }}>Drop-off · {card.dropoffLabel}</Text>
          {vm.distanceEta ? (
            <Text style={{ color: colors.inkSecondary }}>
              {vm.distanceEta}
            </Text>
          ) : null}
          {vm.pickupAtText ? <Text style={{ color: colors.inkSecondary }}>{vm.pickupAtText}</Text> : null}
          {vm.deposit ? (
            <Text style={{ color: colors.inkSecondary }}>{vm.deposit.label}</Text>
          ) : null}
          {vm.timeLeft?.label ? (
            <Text style={{ color: vm.timeLeft.isUrgent ? colors.orange : colors.inkSecondary, fontWeight: '700' }}>
              {vm.timeLeft.label}
            </Text>
          ) : null}
          {card.teslaStub ? <Text style={{ color: colors.inkSecondary }}>{TESLA_FLEET_NOTICE}</Text> : null}
          <FarePanel card={card} />
        </ScrollView>
        <View style={[styles.offerActions, overflows && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
          <Primary
            label={busy ? 'Saving…' : acceptActionLabel(card.status)}
            accessibilityRole="button"
            accessibilityLabel={busy ? 'Saving…' : `${acceptActionLabel(card.status)} offer for ${vm.pay.formattedNet}`}
            onPress={onAccept}
            disabled={busy}
          />
          <Pressable
            onPress={onDecline}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={declineActionLabel(card.status)}
            style={styles.decline}
          >
            <Text style={[styles.declineText, { color: declineDisposition(card.status) === 'cancel' ? colors.orange : colors.inkSecondary }]}>
              {declineActionLabel(card.status)}
            </Text>
          </Pressable>
        </View>
      </Card>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: EDGE },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pillText: { fontWeight: '800', fontSize: 16 },
  peek: { marginHorizontal: 16, marginTop: 10, borderRadius: 22, padding: 16, gap: 8 },
  peekHead: { flexDirection: 'row', justifyContent: 'space-between' },
  peekAmount: { fontSize: 36, fontWeight: '800', letterSpacing: -0.8 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  heatPanel: { marginTop: 8 },
  heatRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  heatLabel: { fontSize: 12, fontWeight: '700' },
  heatToggle: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  heatWindows: { paddingHorizontal: 16, gap: 8, marginTop: 8 },
  heatChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  hotspotRow: { flexGrow: 0, marginTop: 10 },
  hotspots: { paddingHorizontal: 16, gap: 8 },
  hotspot: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  hotspotOn: { color: '#fff', fontWeight: '800' as const },
  hotspotOff: { fontWeight: '800' as const },
  flex: { flex: 1 },
  dock: { position: 'absolute', left: EDGE, right: EDGE, gap: GAP, justifyContent: 'flex-end' },
  cardTitle: { fontWeight: '800', fontSize: 18 },
  live: { alignSelf: 'stretch', borderRadius: 18, padding: 14, gap: 4 },
  liveKicker: { fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  liveTitle: { fontWeight: '800', fontSize: 18 },
  controls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toolCol: { gap: GAP },
  bar: {
    alignSelf: 'stretch',
    borderRadius: 28,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barText: { fontWeight: '800', fontSize: 16, flex: 1, textAlign: 'center' },
  offerFareRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  offerFare: { fontSize: 34, fontWeight: '800', letterSpacing: -0.6 },
  offerFareTag: { fontSize: 16, fontWeight: '700' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  decline: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  declineText: { fontWeight: '700', fontSize: 15 },
  offerWrap: { flexShrink: 1 },
  offerCard: { flexShrink: 1, gap: 0, paddingBottom: 12 },
  offerScroll: { flexGrow: 0, flexShrink: 1 },
  offerBody: { gap: 10, paddingBottom: 2 },
  offerNotice: { fontWeight: '700', fontSize: 13, lineHeight: 18 },
  offerActions: { gap: 8, paddingTop: 10 },
  modalScrim: { flex: 1, backgroundColor: 'rgba(11,18,32,0.45)', justifyContent: 'flex-end' },
  modalCard: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 12 },
})
