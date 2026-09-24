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
import { heatColor, typicalSpots } from 'rides-native/heat.js'
import {
  acceptTrip,
  declineTrip,
  formatCents,
  loadDriverDesk,
  loadEarnings,
  publishDriverCapacity,
  publishDriverLocation,
  setPriorityMode,
  subscribeTrips,
  type DriverDesk,
} from 'rides-native/driverDesk'
import { CUPD_PHONE_DISPLAY, CUPD_PHONE_E164 } from 'rides-native/safety.js'
import {
  formatPickupAt,
  statusHeadline,
  TESLA_FLEET_NOTICE,
  weekNetCents,
  type DriverCard,
} from 'rides-native/tripTags'
import { ORANGE, PURPLE } from 'rides-native/places.js'
import { approvalGateMessage, isSyntheticOffer, syntheticOffers } from 'rides-native/syntheticOffers'
import { loadCounterpart } from 'rides-native/partyProfile.js'

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
  const [riderLine, setRiderLine] = useState<string | null>(null)
  const [hiddenOffers, setHiddenOffers] = useState<string[]>([])
  const approved = status === 'approved'
  const pendingReview = status === 'pending_review'
  const online = Boolean(desk?.online)
  const name = user ? displayFirstName(user.user_metadata?.full_name || user.email?.split('@')[0], 'Driver') : 'Driver'
  const tabClearance = insets.bottom + 72

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
    if (!supabase) return
    setBusy(true)
    setError(null)
    try {
      await declineTrip(supabase, card)
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
  const hotspots = typicalSpots().slice().sort((a, b) => b.intensity - a.intensity).slice(0, 4)
  const pins: MapPin[] = []
  if (self) pins.push({ id: 'me', ...self, title: 'You', pinColor: ORANGE })
  if (offer?.pickupLat != null && offer.pickupLng != null) {
    pins.push({ id: 'pickup', latitude: offer.pickupLat, longitude: offer.pickupLng, title: 'Pickup', pinColor: PURPLE })
  }
  hotspots.forEach((spot) => {
    pins.push({
      id: spot.id,
      latitude: spot.lat,
      longitude: spot.lng,
      title: `${spot.name} · ${demandWord(spot.intensity)}`,
      pinColor: heatColor(spot.intensity),
    })
  })

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
      <CampusMap pins={pins} center={self} colorScheme={scheme} focusToken={focusToken} />
      <View pointerEvents="box-none" style={styles.overlay}>
        <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
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

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hotspots} style={styles.hotspotRow}>
          {desk?.gameDay ? (
            <View style={[styles.hotspot, { backgroundColor: colors.orange }]}>
              <Text style={styles.hotspotOn}>Game day{desk.gameDay.surge_multiplier ? ` · ${desk.gameDay.surge_multiplier}×` : ''}</Text>
            </View>
          ) : null}
          {hotspots.map((spot) => (
            <View key={spot.id} style={[styles.hotspot, { backgroundColor: colors.card }, shadow]}>
              <Text style={{ color: colors.title, fontWeight: '800' }}>{spot.name}</Text>
              <Text style={{ color: colors.orange, fontWeight: '700', fontSize: 12 }}>{demandWord(spot.intensity)}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.flex} pointerEvents="box-none" />

        <View pointerEvents="box-none" style={[styles.dock, { bottom: tabClearance }]}>
          {!configured ? <ErrorText>Add EXPO_PUBLIC_SUPABASE_ANON_KEY as an EAS environment variable, then rebuild.</ErrorText> : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          {user && pendingReview ? (
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
              {riderLine ? <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{riderLine}</Text> : null}
            </Pressable>
          ) : null}
          {offer && !desk?.active ? (
            <RideCard card={offer} busy={busy} onAccept={() => onAccept(offer)} onDecline={() => onDecline(offer)} />
          ) : null}
          <View style={styles.sideTools} pointerEvents="box-none">
            <View style={styles.toolCol}>
              <CircleButton icon="shield" label="Safety" onPress={() => setSafetyOpen(true)} />
              <CircleButton icon="sparkles" label="Priority mode" onPress={onPriority} />
            </View>
            <View style={styles.toolCol}>
              <CircleButton icon="stats-chart" label="Earnings" onPress={() => router.push('/earnings')} />
              <CircleButton icon="locate" label="Recenter map" onPress={() => setFocusToken((value) => value + 1)} />
            </View>
          </View>
          <GoButton online={online} busy={busy} onPress={toggle} />
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
  onAccept,
  onDecline,
}: {
  card: DriverCard
  busy: boolean
  onAccept: () => void
  onDecline: () => void
}) {
  const { colors } = useTheme()
  const opacity = useState(() => new Animated.Value(0))[0]
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }).start()
  }, [opacity])
  return (
    <Animated.View style={{ opacity }}>
      <Card>
        <Text style={[styles.offerFare, { color: colors.ink }]}>{formatCents(card.driverNetCents)}</Text>
        <Text style={{ color: colors.inkSecondary }}>{statusHeadline(card.status)} · you net 80%</Text>
        <View style={styles.tags}>
          {card.tagLabels.map((label) => (
            <Tag key={label} label={label} tone={/Tesla|Game|Weekend|Student/.test(label) ? 'orange' : 'purple'} />
          ))}
        </View>
        <Text style={{ color: colors.ink, fontWeight: '700' }}>
          {card.firstName}{card.riderRating ? ` · ${card.riderRating.toFixed(1)}` : ''}
          {card.rideType ? ` · ${card.rideType}` : ''}
        </Text>
        <Text style={{ color: colors.ink, fontWeight: '700' }}>Pickup · {card.pickupLabel}</Text>
        <Text style={{ color: colors.ink, fontWeight: '700' }}>Drop-off · {card.dropoffLabel}</Text>
        {card.etaMin || card.distanceMi ? (
          <Text style={{ color: colors.inkSecondary }}>
            {[card.etaMin ? `${card.etaMin} min away` : null, card.distanceMi ? `${card.distanceMi} mi` : null].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        {card.pickupAt ? <Text style={{ color: colors.inkSecondary }}>{formatPickupAt(card.pickupAt)}</Text> : null}
        {card.depositCents > 0 ? <Text style={{ color: colors.inkSecondary }}>25% deposit · {formatCents(card.depositCents)}</Text> : null}
        {card.teslaStub ? <Text style={{ color: colors.inkSecondary }}>{TESLA_FLEET_NOTICE}</Text> : null}
        <FarePanel card={card} />
        <Primary label={busy ? 'Saving…' : 'Accept'} onPress={onAccept} disabled={busy} />
        <Pressable onPress={onDecline} disabled={busy} style={styles.decline}>
          <Text style={{ color: colors.inkSecondary, fontWeight: '700' }}>Decline</Text>
        </Pressable>
      </Card>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
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
  hotspotRow: { flexGrow: 0, marginTop: 10 },
  hotspots: { paddingHorizontal: 16, gap: 8 },
  hotspot: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  hotspotOn: { color: '#fff', fontWeight: '800' },
  flex: { flex: 1 },
  dock: { position: 'absolute', left: 12, right: 12, gap: 10, alignItems: 'center' },
  cardTitle: { fontWeight: '800', fontSize: 18 },
  live: { alignSelf: 'stretch', borderRadius: 18, padding: 14, gap: 4 },
  liveKicker: { fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  liveTitle: { fontWeight: '800', fontSize: 18 },
  sideTools: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between' },
  toolCol: { gap: 10 },
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
  offerFare: { fontSize: 32, fontWeight: '800', letterSpacing: -0.6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  decline: { alignItems: 'center', paddingVertical: 4 },
  modalScrim: { flex: 1, backgroundColor: 'rgba(11,18,32,0.45)', justifyContent: 'flex-end' },
  modalCard: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 12 },
})
