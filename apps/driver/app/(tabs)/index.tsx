import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, AppState, Easing, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CampusMap, type MapPin } from '@/components/CampusMap'
import { FarePanel } from '@/components/FarePanel'
import { DriverEndTripSheet } from '@/components/DriverEndTripSheet'
import { Card, ErrorText, Primary, Tag, useCardShadow } from '@/components/chrome'
import { CircleButton, GoButton } from '@/components/shell'
import { OfferRouteMap } from '@/components/OfferRouteMap'
import { DriverStatusCard } from '@/components/DriverStatusCard'
import { CommunityMatchChips } from 'rides-native/CommunityMatchChips'
import { PerksStrip } from '@/components/PerksStrip'
import { useMyMarker } from '@/lib/myMarker'
import { ForecastCard } from '@/components/ForecastCard'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { notifyAcceptedRide, setRideAlertSurface } from '@/lib/push'
import { shownCents } from '@/lib/shown'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { HOME_CLUTTER_SPRING, homeClutterTranslateY } from '@/lib/bottomCluster'
import { driverPresence, goOffline, goOnline, usePresence } from '@/lib/presence'
import { fetchDriverApplication } from 'rides-native/drivers'
import { fetchInspectionDeadline, fetchMyDriverDocuments } from 'rides-native/driverOnboardingClient'
import { decideGoPress, idleGoTone } from 'rides-native/goPress'
import { offerPayoutFigures } from 'rides-native/offerRoute.js'
import {
  ATTENTION_COPY,
  DOCUMENTS_GO_ONLINE_COPY,
  goOnlineDocumentGate,
  type DocumentRow,
} from 'rides-native/documentCategories'
import { documentAttentionItems } from '../../../../shared/documentAiReview.js'
import {
  INSPECTION_OVERDUE_COPY,
  inspectionCountdown,
  inspectionGoOnlineGate,
} from 'rides-native/vehicleInspection'
import {
  DOCUMENT_BANNER_ELEVATION,
  DOCUMENT_BANNER_Z,
  OFFER_CARD_ELEVATION,
  OFFER_CARD_Z,
  dedupeOffersById,
  documentBannersCollapsed,
  offerAcceptSeconds,
  offerSheetBottomInset,
  offerSheetOwnsBottom,
  setHomeOfferId,
} from 'rides-native/offerStack.js'
import { riderDriverFirstName } from '../../../../shared/riderDriverPrivacy.js'
import { heatColor } from 'rides-native/heat.js'
import { HEAT_WINDOWS } from 'rides-native/places.js'
import { loadBusySpots, type BusySpot } from '@/lib/busySpots'
import { useDemandHeat } from '@/lib/useDemandHeat'
import {
  acceptTrip,
  declineDriverOffer,
  markSearchingOffers,
  formatCents,
  loadDriverDesk,
  loadGameDay,
  loadEarnings,
  publishDriverCapacity,
  subscribeTrips,
  type DriverDesk,
} from 'rides-native/driverDesk'
import {
  acceptActionLabel,
  declineActionLabel,
  declineDisposition,
  driverStatusDetail,
  formatPickupAt,
  preferredRequestNote,
  statusHeadline,
  tagTone,
  COMFORT_FLEET_NOTICE,
  weekNetCents,
  type DriverCard,
} from 'rides-native/tripTags'
import { declinePassMessage, offlineWhileOfferedMessage } from 'rides-native/matchingMessages'
import { etaHoldLine } from 'rides-native/liveTrip'
import { followEtaLine } from 'rides-native/roadFollow'
import { driverPickupTarget } from 'rides-native/riderLivePickup'
import { ORANGE, PURPLE } from 'rides-native/places.js'
import { useReduceMotion } from 'rides-native/shared/reduceMotion.js'
import { motion } from 'rides-native/shared/theme.js'
import { gameDayNotice, type GameDayNotice } from 'rides-native/gameDayNotice.js'
import { GameDaySurgeLine } from 'rides-native/GameDayBoard.jsx'
import { useGameDayExperience } from 'rides-native/useGameDayExperience.js'
import { approvalGateMessage, isSyntheticOffer } from 'rides-native/syntheticOffers'
import { driverGateView } from 'rides-native/driverGateView'
import { loadCounterpart } from 'rides-native/partyProfile.js'
import { offerCardViewModel } from 'rides-native/offerCard'
import { offerHourly } from 'rides-native/offerLadder.js'
import { WorthItLegend } from 'rides-native/WorthItLegend'
import { offerCardGauge } from 'rides-native/offerGauge'
import { fetchOfferPreview, riderInitials } from 'rides-native/offerPreviewClient'
import { OfferGauge } from '@/components/OfferGauge'
import { tipBoostOfferLine } from '../../../../shared/prepaidTip.js'
import { ACTIVE_TRIP_RECONCILE_MS, reconcileActiveTrip } from 'rides-native/activeTripReconcile'
import { sendTripHeartbeat } from 'rides-native/tripHeartbeat'
import { canDriverEnd } from '../../../../shared/driverEndTrip.js'

/** Home map overlay grid: screen-edge gutter, spacing between floating pieces, clearance under the status bar. */
const EDGE = 16
const GAP = 12
const TOP_MARGIN = 8

async function currentFix() {
  try {
    const perm = await Location.requestForegroundPermissionsAsync()
    if (perm.status !== 'granted') return null
    const last = await Location.getLastKnownPositionAsync()
    const pos = last || await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    const heading = pos.coords.heading
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      heading: heading != null && heading >= 0 ? heading : null,
    }
  } catch {
    return null
  }
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
  const { colors, scheme, earningsPrivate, autoAccept, setAutoAccept } = useTheme()
  const shadow = useCardShadow()
  const { user, configured } = useAuth()
  const { pulse, pulseShift } = useFeedback()
  const [desk, setDesk] = useState<DriverDesk | null>(null)
  const [tripReconciled, setTripReconciled] = useState(false)
  const [todayCents, setTodayCents] = useState(0)
  const [weekCents, setWeekCents] = useState(0)
  const [lastTrip, setLastTrip] = useState<string | null>(null)
  const [status, setStatus] = useState('none')
  const [reason, setReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [goCue, setGoCue] = useState(0)
  const [documents, setDocuments] = useState<DocumentRow[] | null>(null)
  const [inspectionDueAt, setInspectionDueAt] = useState<string | null>(null)
  const [self, setSelf] = useState<{ latitude: number; longitude: number } | null>(null)
  const [demandOpen, setDemandOpen] = useState(false)
  const [focusToken, setFocusToken] = useState(0)
  const [showHeat, setShowHeat] = useState(true)
  const [heatWindow, setHeatWindow] = useState('now')
  const [spots, setSpots] = useState<BusySpot[]>([])
  const [heatCaption, setHeatCaption] = useState('Popular campus spots from ride requests.')
  const [heatBlended, setHeatBlended] = useState(false)
  const [heatLoading, setHeatLoading] = useState(true)
  const [peakOverride, setPeakOverride] = useState<boolean | null>(null)
  const [riderLine, setRiderLine] = useState<string | null>(null)
  const [hiddenOffers, setHiddenOffers] = useState<string[]>([])
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null)
  const [gameNotice, setGameNotice] = useState<GameDayNotice | null>(null)
  const gameDayExperience = useGameDayExperience(supabase, { driverId: user?.id || null })
  const myMarker = useMyMarker()
  const [refreshing, setRefreshing] = useState(false)
  const [offerNote, setOfferNote] = useState<string | null>(null)
  const gate = useMemo(
    () => driverGateView(status, { rejectionReason: reason }),
    [status, reason]
  )
  const canSeeOffers = gate.canSeeOffers
  const canGoOnline = gate.canGoOnline
  const approved = status === 'approved'
  const online = Boolean(desk?.online)
  const documentGate = useMemo(
    () => (documents ? goOnlineDocumentGate(documents) : null),
    [documents],
  )
  const attentionItems = useMemo(
    () => documentAttentionItems(documents || []),
    [documents],
  )
  const inspectionGate = inspectionGoOnlineGate({
    documents: documents || [],
    dueAt: inspectionDueAt,
    now: new Date(),
  })
  const inspectionReminder = inspectionCountdown({
    documents: documents || [],
    dueAt: inspectionDueAt,
    now: new Date(),
  })?.message || ''
  const showDocumentGate = Boolean(user && documentGate && !documentGate.allowed)
  const showInspectionGate = Boolean(user && !showDocumentGate && !inspectionGate.allowed)
  const showInspectionReminder = Boolean(user && !showDocumentGate && inspectionGate.allowed && inspectionReminder)
  const idleTone = useMemo(
    () => idleGoTone({ documents, dueAt: inspectionDueAt, canGoOnline }),
    [documents, inspectionDueAt, canGoOnline],
  )
  const { height: windowHeight } = useWindowDimensions()
  const clutterY = useSharedValue(homeClutterTranslateY(online, windowHeight))
  const [clutterInteractive, setClutterInteractive] = useState(!online)
  useEffect(() => {
    setRideAlertSurface({ online })
    if (online) {
      setClutterInteractive(false)
      clutterY.value = withSpring(homeClutterTranslateY(true, windowHeight), HOME_CLUTTER_SPRING)
      return
    }
    clutterY.value = withSpring(homeClutterTranslateY(false), HOME_CLUTTER_SPRING, (finished) => {
      if (finished) runOnJS(setClutterInteractive)(true)
    })
  }, [clutterY, online, windowHeight])
  const clutterStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: clutterY.value }],
  }))
  const tabClearance = offerSheetBottomInset(insets.bottom)
  // The dock sits between the status bar and the tab bar, including the home-indicator inset.
  // While an offer is up, END, the queue, and the earnings pill step aside so the sheet can use that space.
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
    if (!user || !supabase) {
      setDocuments(null)
      setInspectionDueAt(null)
      return
    }
    const [application, rows, deadline] = await Promise.all([
      fetchDriverApplication(supabase, user.id),
      fetchMyDriverDocuments(supabase, user.id).catch(() => null),
      fetchInspectionDeadline(supabase, user.id).catch(() => null),
    ])
    setDocuments(rows)
    setInspectionDueAt(deadline?.inspection_due_at ?? null)
    if (application.error) {
      setError(application.error)
      return
    }
    const nextStatus = application.application?.onboarding_status || 'none'
    setStatus(nextStatus)
    setReason(application.application?.rejection_reason || null)
    const currentGate = driverGateView(nextStatus, {
      rejectionReason: application.application?.rejection_reason || null,
    })
    if (currentGate.canSeeOffers) {
      const loaded = await loadDriverDesk(supabase, user.id)
      if (loaded.online) markSearchingOffers(supabase, loaded.offers).catch(() => {})
      const active = loaded.active
      const decision = active
        ? reconcileActiveTrip({ id: active.id, status: active.status }, { id: active.id, status: active.status })
        : null
      setDesk(decision?.action === 'clear' ? { ...loaded, active: null } : loaded)
      setTripReconciled(true)
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
    } else {
      setDesk(null)
      setTripReconciled(true)
    }
  }, [user])

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh application status')
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

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
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load driver home'))
  }, [refresh])

  useEffect(() => {
    if (!supabase || !canSeeOffers) return undefined
    return subscribeTrips(supabase, () => {
      refresh().catch(() => {})
    })
  }, [canSeeOffers, refresh])

  const deskRef = useRef(desk)
  deskRef.current = desk
  useEffect(() => {
    if (!supabase || !user || !canSeeOffers) return undefined
    const reconcile = () => {
      const active = deskRef.current?.active
      if (active?.id && canDriverEnd(active.status)) void sendTripHeartbeat(supabase, active.id)
      refresh().catch(() => {})
    }
    const timer = setInterval(reconcile, ACTIVE_TRIP_RECONCILE_MS)
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcile()
    })
    return () => {
      clearInterval(timer)
      listener.remove()
    }
  }, [canSeeOffers, refresh, user])

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

  // One app-wide heartbeat (lib/presence). This screen only configures it, so a second
  // mounted Home (e.g. after a deep-link sign-in) cannot keep writing online after END.
  const locationTracking = usePresence()
  useEffect(() => { driverPresence.setDriver(user?.id ?? null) }, [user?.id])
  useEffect(() => {
    if (!desk || !status) return
    driverPresence.adoptServerOnline(Boolean(approved && desk.online))
  }, [desk, status, approved])
  useEffect(() => {
    driverPresence.setTrip(desk?.active ? { id: desk.active.id, status: desk.active.status } : null)
  }, [desk?.active?.id, desk?.active?.status])
  useEffect(() => driverPresence.onFix((fix) => setSelf({ latitude: fix.lat, longitude: fix.lng })), [])

  async function toggle() {
    setGoCue((value) => value + 1)
    if (!user) {
      router.push('/sign-in')
      return
    }
    const nextOnline = !online
    if (nextOnline) {
      const rows = supabase
        ? await fetchMyDriverDocuments(supabase, user.id).catch(() => null)
        : null
      const deadline = supabase
        ? await fetchInspectionDeadline(supabase, user.id).catch(() => null)
        : null
      const dueAt = deadline?.inspection_due_at ?? null
      const decision = decideGoPress({
        goingOnline: true,
        documents: rows,
        dueAt,
        now: new Date(),
        canGoOnline,
      })
      if (decision.outcome === 'attention') {
        setError(null)
        router.push({ pathname: '/documents', params: { attention: '1' } })
        return
      }
      if (decision.outcome !== 'online') {
        setError(gate.body)
        return
      }
    }
    setBusy(true)
    setError(null)
    try {
      const fix = nextOnline ? await currentFix() : null
      if (nextOnline) await goOnline(user.id, fix)
      else await goOffline(user.id)
      if (fix) setSelf({ latitude: fix.lat, longitude: fix.lng })
      if (nextOnline) {
        await publishDriverCapacity(supabase, user.id, desk?.vehicle?.seats)
        setFocusToken((value: number) => value + 1)
      }
      pulseShift(nextOnline ? 'GO' : 'END')
      if (nextOnline) {
        setOfferNote(null)
        AccessibilityInfo.announceForAccessibility('You are now online')
      } else {
        const held = offer && !desk?.active ? { status: offer.status } : null
        const message = offlineWhileOfferedMessage({ online: false, card: held })
        setOfferNote(message)
        AccessibilityInfo.announceForAccessibility(message || 'You are now offline')
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update online status')
    } finally {
      setBusy(false)
    }
  }

  async function onAccept(card: DriverCard) {
    if (busy || !user || !supabase) return
    if (!canSeeOffers || !approved || isSyntheticOffer(card)) {
      setError(approvalGateMessage())
      return
    }
    setBusy(true)
    setError(null)
    try {
      await acceptTrip(supabase, card, user.id)
      notifyAcceptedRide(card).catch(() => {})
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
      setHiddenOffers((current: string[]) => (current.includes(card.id) ? current : [...current, card.id]))
      return
    }
    if (!supabase || !user) return
    setBusy(true)
    setError(null)
    try {
      const result = await declineDriverOffer(supabase, card, user.id)
      pulse('decline')
      const message = result?.disposition === 'release' && (result.passed || result.released)
        ? declinePassMessage({ keptSearching: true })
        : null
      if (message) {
        setOfferNote(message)
        AccessibilityInfo.announceForAccessibility(message)
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not decline')
    } finally {
      setBusy(false)
    }
  }

  const liveOffers = dedupeOffersById((canSeeOffers ? desk?.offers || [] : []).filter(
    (card: DriverCard) => !isSyntheticOffer(card) && !hiddenOffers.includes(card.id),
  ))
  const offer = liveOffers.find((card: DriverCard) => card.id === selectedOfferId) || liveOffers[0] || null
  const liveCard = online && offer && !desk?.active ? offer : null
  const offerOwnsBottom = offerSheetOwnsBottom({ offerId: liveCard?.id ?? null, activeTrip: Boolean(desk?.active) })
  useEffect(() => {
    setHomeOfferId(liveCard?.id ?? null)
    return () => setHomeOfferId(null)
  }, [liveCard?.id])
  const bannersCollapsed = documentBannersCollapsed({ online, offerId: liveCard?.id })
  const goOnlineItems = attentionItems.filter((item) => !item.id.startsWith('inspection'))
  const liveFrom = self
    ? { lat: self.latitude, lng: self.longitude }
    : desk?.lat != null && desk?.lng != null
      ? { lat: Number(desk.lat), lng: Number(desk.lng) }
      : null
  const liveEta = desk?.active
    ? etaHoldLine(desk.active.status, followEtaLine(desk.active.status, liveFrom, desk.active))
    : null
  const hotspots = spots.slice().sort((a: BusySpot, b: BusySpot) => b.intensity - a.intensity).slice(0, 4)
  const pins: MapPin[] = []
  if (self) pins.push({ id: 'me', ...self, title: 'You', pinColor: myMarker?.fill || ORANGE, kind: 'self', marker: myMarker })
  liveOffers.forEach((card: DriverCard) => {
    const pin = driverPickupTarget(card)
    if (!pin) return
    pins.push({
      id: card.id,
      latitude: pin.latitude,
      longitude: pin.longitude,
      title: pin.live ? `${card.pickupLabel} · live` : card.pickupLabel,
      pinColor: PURPLE,
      kind: 'request',
    })
  })
  // When heat is on, circles carry demand — keep pins to you + requests only.
  if (!online && !showHeat) {
    hotspots.forEach((spot: BusySpot) => {
      pins.push({
        id: spot.id,
        latitude: spot.lat,
        longitude: spot.lng,
        title: `${spot.name} · ${demandWord(spot.intensity)}`,
        pinColor: heatColor(spot.intensity),
      })
    })
  }



  function onPinPress(id: string) {
    if (id === 'me') {
      setFocusToken((value: number) => value + 1)
      return
    }
    const card = liveOffers.find((row: DriverCard) => row.id === id)
    if (!card) return
    setSelectedOfferId(card.id)
  }

  // Peak mode: auto on game days, driver can flip it either way.
  const peakMode = peakOverride ?? Boolean(gameNotice?.live)
  const liveHeat = showHeat && heatWindow === 'now'
  const demand = useDemandHeat({ enabled: liveHeat, peak: peakMode })

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <CampusMap
        demandCells={liveHeat ? demand.cells : []}
        peak={liveHeat && peakMode}
        pins={pins}
        center={self}
        colorScheme={scheme}
        focusToken={focusToken}
        spots={spots}
        showHeat={showHeat}
        heatWindow={heatWindow}
        gameDay={Boolean(gameNotice?.live)}
        gameDayLabel={gameNotice?.live ? gameNotice.headline : null}
        lockOnCenter={Boolean(online && self)}
        onPinPress={onPinPress}
      />
      <View pointerEvents="box-none" style={styles.overlay}>
        <Reanimated.View
          pointerEvents={clutterInteractive && !liveCard ? 'box-none' : 'none'}
          style={[styles.clutter, clutterStyle]}
        >
          <View style={[styles.top, { paddingTop: dockTop }]} pointerEvents="box-none">
            <CircleButton icon="inbox" label="Messages" onPress={() => router.push('/inbox')} />
            <View style={styles.topSpacer} />
            <CircleButton icon="search" label="Search and discover" onPress={() => router.push('/discover')} />
          </View>
          {offerOwnsBottom ? null : (
          <View pointerEvents="box-none" style={[styles.earningsWrap, { top: dockTop }]}>
            <Pressable
              onPress={() => router.push('/earnings')}
              style={[styles.earningsButton, shadow, { backgroundColor: colors.card }]}
              accessibilityRole="button"
              accessibilityLabel={`Earnings, ${shownCents(todayCents, earningsPrivate)} today`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.pillText, { color: colors.title }]}>{shownCents(todayCents, earningsPrivate)}</Text>
              <Text style={{ color: colors.inkSecondary, fontWeight: '800', fontSize: 12 }}>Earnings</Text>
            </Pressable>
          </View>
          )}

          <View style={styles.heatPanel}>
            <Pressable
              onPress={() => setDemandOpen((value: boolean) => !value)}
              accessibilityRole="button"
              accessibilityLabel="Busy areas, peak, and live demand"
              accessibilityState={{ expanded: demandOpen }}
              style={styles.demandToggle}
            >
              <Text style={[styles.heatLabel, { color: colors.inkSecondary }]}>Busy areas, peak, and live demand</Text>
              <Text style={{ color: colors.orange, fontWeight: '800' }}>{demandOpen ? 'Hide' : 'Show'}</Text>
            </Pressable>
            {demandOpen ? (
              <>
                <View style={styles.heatRow}>
                  <Text style={[styles.heatLabel, { color: colors.inkSecondary }]}>Busy areas</Text>
                  <Pressable
                    onPress={() => setShowHeat((value: boolean) => !value)}
                    style={[styles.heatToggle, { backgroundColor: showHeat ? colors.orange : colors.card }]}
                    accessibilityRole="switch"
                    accessibilityLabel={showHeat ? 'Hide busy areas' : 'Show busy areas'}
                    accessibilityState={{ checked: showHeat }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={{ color: showHeat ? '#fff' : colors.title, fontWeight: '800', fontSize: 12 }}>
                      {showHeat ? 'On' : 'Off'}
                    </Text>
                  </Pressable>
                </View>
                {showHeat ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.heatWindows}>
                    <Pressable
                      onPress={() => setPeakOverride(!peakMode)}
                      accessibilityRole="switch"
                      accessibilityLabel="Peak mode for game days and airport rushes"
                      accessibilityState={{ checked: peakMode }}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                      style={[styles.heatChip, peakMode ? styles.heatChipOn : { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <Text style={{ color: peakMode ? '#FFFFFF' : colors.title, fontWeight: '700', fontSize: 13, letterSpacing: 0.2 }}>Peak</Text>
                    </Pressable>
                    {HEAT_WINDOWS.map((item: { id: string; label: string }) => {
                      const on = item.id === heatWindow
                      return (
                        <Pressable
                          key={item.id}
                          onPress={() => setHeatWindow(item.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`${item.label} demand`}
                          accessibilityState={{ selected: on }}
                          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                          style={[styles.heatChip, { backgroundColor: on ? colors.orange : colors.card }]}
                        >
                          <Text style={{ color: on ? '#fff' : colors.title, fontWeight: '800', fontSize: 12 }}>{item.label}</Text>
                        </Pressable>
                      )
                    })}
                  </ScrollView>
                ) : null}
                <Text style={{ color: colors.inkSecondary, fontSize: 12, marginHorizontal: 16, marginTop: 6 }}>
                  {!showHeat
                    ? 'Busy areas are hidden.'
                    : liveHeat
                      ? demand.cells.length
                        ? `Live demand · last ${peakMode ? 30 : 20} min · tap a zone`
                        : demand.updatedAt ? 'Quiet right now · updates every 30 s' : 'Loading live demand…'
                      : heatLoading ? 'Loading campus demand…' : `${heatCaption}${heatBlended ? ' · Live + typical' : ''}`}
                </Text>
                {canSeeOffers && !desk?.active ? <ForecastCard /> : null}
              </>
            ) : null}
          </View>

          {!bannersCollapsed && showDocumentGate && documentGate ? (
            <Pressable
              onPress={() => router.push('/documents')}
              accessibilityRole="link"
              accessibilityLabel={`${ATTENTION_COPY}. ${DOCUMENTS_GO_ONLINE_COPY}. ${documentGate.sections.map((section) => section.label).join(', ')}. ${goOnlineItems.map((item) => `${item.label}. ${item.reason}`).join(' ')}. Documents`}
              style={[styles.docGate, { backgroundColor: colors.card, borderColor: colors.orange, zIndex: DOCUMENT_BANNER_Z, elevation: DOCUMENT_BANNER_ELEVATION }]}
            >
              <Text style={[styles.docGateTitle, { color: colors.orange }]}>{ATTENTION_COPY}</Text>
              <Text style={[styles.docGateSections, { color: colors.title }]}>{DOCUMENTS_GO_ONLINE_COPY}</Text>
              <Text style={[styles.docGateSections, { color: colors.title }]}>
                {documentGate.sections.map((section) => section.label).join(', ')}
              </Text>
              {goOnlineItems.map((item) => (
                <Text key={item.id} style={[styles.docGateReason, { color: colors.title }]}>
                  {item.label}: {item.reason}
                </Text>
              ))}
              <Text style={[styles.docGateLink, { color: colors.orange }]}>Documents</Text>
            </Pressable>
          ) : null}
          {!bannersCollapsed && showInspectionGate ? (
            <Pressable
              onPress={() => router.push('/documents')}
              accessibilityRole="link"
              accessibilityLabel={`${INSPECTION_OVERDUE_COPY}. Documents`}
              style={[styles.docGate, { backgroundColor: colors.card, borderColor: colors.danger, zIndex: DOCUMENT_BANNER_Z, elevation: DOCUMENT_BANNER_ELEVATION }]}
            >
              <Text style={[styles.docGateTitle, { color: colors.orange }]}>{ATTENTION_COPY}</Text>
              <Text style={[styles.docGateSections, { color: colors.title }]}>{INSPECTION_OVERDUE_COPY}</Text>
              {attentionItems.filter((item) => item.id.startsWith('inspection')).map((item) => (
                <Text key={item.id} style={[styles.docGateReason, { color: colors.title }]}>
                  {item.label}: {item.reason}
                </Text>
              ))}
              <Text style={[styles.docGateLink, { color: colors.orange }]}>Documents</Text>
            </Pressable>
          ) : null}
          {!bannersCollapsed && showInspectionReminder ? (
            <Pressable
              onPress={() => router.push('/documents')}
              accessibilityRole="link"
              accessibilityLabel={`${inspectionReminder}. Documents`}
              style={[styles.docGate, { backgroundColor: colors.card, borderColor: colors.orange, zIndex: DOCUMENT_BANNER_Z, elevation: DOCUMENT_BANNER_ELEVATION }]}
            >
              <Text style={[styles.docGateTitle, { color: colors.title }]}>{inspectionReminder}</Text>
              <Text style={[styles.docGateLink, { color: colors.orange }]}>Documents</Text>
            </Pressable>
          ) : null}

          {!canSeeOffers ? (
            <View style={styles.statusWrap}>
              <DriverStatusCard
                status={status}
                gate={gate}
                reason={reason}
                onRefresh={onPullRefresh}
                refreshing={refreshing}
              />
            </View>
          ) : null}
          {!online ? (
            <GameDaySurgeLine
              model={gameDayExperience.ready ? gameDayExperience.model : null}
              online={false}
              onPress={() => router.push('/game-day')}
            />
          ) : null}
        </Reanimated.View>

        <View pointerEvents="box-none" style={[styles.dock, styles.offerDock, { top: dockTop, bottom: tabClearance }]}>
          {!configured ? <ErrorText>Add EXPO_PUBLIC_SUPABASE_ANON_KEY as an EAS environment variable, then rebuild.</ErrorText> : null}
          {locationTracking.error ? (
            <View>
              <ErrorText>{locationTracking.error}</ErrorText>
              <Primary label="Retry location" onPress={locationTracking.retry} />
            </View>
          ) : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          {offerNote && !liveCard ? (
            <Text accessibilityLiveRegion="polite" style={{ color: colors.ink, fontWeight: '700', fontSize: 14 }}>
              {offerNote}
            </Text>
          ) : null}
          {tripReconciled && desk?.active ? (
            <Pressable
              onPress={() => router.push({ pathname: '/trip', params: { id: desk.active!.id } })}
              accessibilityRole="button"
              accessibilityLabel={`Active trip: ${statusHeadline(desk.active.status)}, pickup ${desk.active.pickupLabel}, drop-off ${desk.active.dropoffLabel}`}
              accessibilityHint="Opens active trip navigation"
              style={[styles.live, { backgroundColor: colors.fill }]}
            >
              <Text style={[styles.liveKicker, { color: colors.orange }]}>LIVE TRIP</Text>
              <Text style={[styles.liveTitle, { color: colors.onAccent }]}>{statusHeadline(desk.active.status)}</Text>
              <Text style={{ color: colors.onAccent }}>{desk.active.pickupLabel} → {desk.active.dropoffLabel}</Text>
              {liveEta && !locationTracking.error ? <Text style={{ color: colors.orange, fontWeight: '800' }}>{liveEta}</Text> : null}
              {riderLine ? <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{riderLine}</Text> : null}
            </Pressable>
          ) : null}
          {tripReconciled && desk?.active && canDriverEnd(desk.active.status) ? (
            <DriverEndTripSheet
              supabase={supabase}
              tripId={desk.active.id}
              disabled={busy}
              onEnded={() => {
                pulse('cancel')
                refresh().catch(() => {})
              }}
            />
          ) : null}
          {liveCard ? (
            <RideCard
              card={liveCard}
              busy={busy}
              notice={
                liveCard.status === 'searching' || liveCard.status === 'offered'
                  ? driverStatusDetail(liveCard.status)
                  : null
              }
              driver={liveFrom ? { lat: liveFrom.lat, lng: liveFrom.lng } : null}
              favorite={Boolean(liveCard.riderId && autoAccept.favoriteRiders.some((rider) => rider.id === liveCard.riderId))}
              onFavorite={() => {
                if (!liveCard.riderId) return
                const next = autoAccept.favoriteRiders.filter((rider) => rider.id !== liveCard.riderId)
                setAutoAccept({
                  favoriteRiders: autoAccept.favoriteRiders.some((rider) => rider.id === liveCard.riderId)
                    ? next
                    : [{ id: liveCard.riderId, name: riderDriverFirstName(liveCard.firstName, 'Rider') || 'Rider' }, ...autoAccept.favoriteRiders].slice(0, 50),
                })
              }}
              onAccept={() => onAccept(liveCard)}
              onDecline={() => onDecline(liveCard)}
            />
          ) : null}
          {offerOwnsBottom ? null : (
          <View style={styles.goRow} pointerEvents="box-none">
            {online ? (
              <CircleButton icon="list" label="Ride queue" onPress={() => router.push('/queue')} />
            ) : <View style={styles.goSide} />}
            <View style={styles.goSlot}>
              <GoButton
                online={online}
                busy={busy}
                tone={idleTone}
                cue={goCue}
                onPress={toggle}
              />
              {online ? (
                <Text style={[styles.onlineStatus, { color: colors.inkSecondary }]} accessibilityLiveRegion="polite">You're online</Text>
              ) : null}
            </View>
            <View style={styles.goSide} />
          </View>
          )}
        </View>
      </View>
    </View>
  )
}

export function RideCard({
  card,
  busy,
  notice,
  driver,
  favorite,
  onFavorite,
  onAccept,
  onDecline,
}: {
  card: DriverCard
  busy: boolean
  notice?: string | null
  driver?: { lat: number; lng: number } | null
  favorite?: boolean
  onFavorite?: () => void
  onAccept: () => void
  onDecline: () => void
}) {
  const { colors } = useTheme()
  const [tick, setTick] = useState(() => Date.now())
  const acceptClock = offerAcceptSeconds(card, tick)
  const exclusiveLeft = acceptClock?.kind === 'exclusive' ? acceptClock.seconds : null
  const poolLeft = acceptClock?.kind === 'pool' ? acceptClock.seconds : null
  const secondsLeft = acceptClock?.seconds ?? null
  const pulsing = exclusiveLeft != null && exclusiveLeft > 0
  const vm = offerCardViewModel(secondsLeft == null ? card : { ...card, secondsLeft })
  const hourlyQuote = offerHourly(card, driver)
  const gauge = offerCardGauge(card, driver)
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof fetchOfferPreview>>>(null)
  useEffect(() => {
    let alive = true
    setPreview(null)
    if (!isSyntheticOffer(card)) {
      fetchOfferPreview(supabase, card.id).then((p) => { if (alive) setPreview(p) })
    }
    return () => { alive = false }
  }, [card.id])
  const riderFirst = riderDriverFirstName(card.firstName || preview?.firstName || '', 'Rider') || 'Rider'
  const avatarUrl = card.riderAvatarUrl || preview?.avatarUrl || null
  const ratingAvg = (card as { riderRating?: number }).riderRating ?? preview?.ratingAvg ?? null
  const prepaidTipCents = Number((card as { prepaidTipCents?: number }).prepaidTipCents) || 0
  const tipBoostLine = tipBoostOfferLine(vm.pay.netCents + prepaidTipCents, prepaidTipCents)
  const payoutFigures = offerPayoutFigures(card, driver)
  const pickupPoint = card.pickupLat != null && card.pickupLng != null
    ? { latitude: Number(card.pickupLat), longitude: Number(card.pickupLng) }
    : null
  const dropoffPoint = card.dropoffLat != null && card.dropoffLng != null
    ? { latitude: Number(card.dropoffLat), longitude: Number(card.dropoffLng) }
    : null
  const preferredNote = preferredRequestNote(card)
  const reduceMotion = useReduceMotion()
  const rise = useState(() => new Animated.Value(reduceMotion ? 0 : 16))[0]
  const glow = useRef(new Animated.Value(0.35)).current
  const scrollRef = useRef<ScrollView>(null)
  const [viewport, setViewport] = useState(0)
  const [content, setContent] = useState(0)
  const overflows = viewport > 0 && content > viewport + 1
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [card.id])
  useEffect(() => {
    if (reduceMotion) {
      rise.setValue(0)
      return undefined
    }
    rise.setValue(16)
    const enter = Animated.timing(rise, {
      toValue: 0,
      duration: motion.enterFadeMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    enter.start()
    return () => enter.stop()
  }, [reduceMotion, rise])
  useEffect(() => {
    if (!pulsing || reduceMotion) {
      glow.setValue(1)
      return undefined
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0.35, duration: 700, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [glow, pulsing, reduceMotion])
  useEffect(() => {
    // Hint that the breakdown scrolls when the card had to shrink to fit.
    if (overflows) scrollRef.current?.flashScrollIndicators()
  }, [overflows, card.id])
  return (
    // flexShrink lets the dock squeeze the card to the room left above the controls;
    // only the details scroll — Accept / Decline stay pinned and visible.
    <Animated.View style={[styles.offerWrap, { transform: [{ translateY: rise }], zIndex: OFFER_CARD_Z, elevation: OFFER_CARD_ELEVATION }]}>
      <Card
        variant="offer"
        style={[styles.offerCard, pulsing ? { borderColor: colors.orange, borderWidth: 2 } : null]}
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
          onLayout={(event: { nativeEvent: { layout: { height: number } } }) => setViewport(event.nativeEvent.layout.height)}
          onContentSizeChange={(_: number, height: number) => setContent(height)}
        >
          {notice ? <Text style={[styles.offerNotice, { color: colors.orange }]}>{notice}</Text> : null}
          <View style={styles.riderRow}>
            {avatarUrl ? (
              <Image
                source={{ uri: avatarUrl }}
                style={styles.avatar}
                accessibilityIgnoresInvertColors
                accessibilityLabel={`${riderFirst} profile photo`}
              />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.purple }]}>
                <Text style={styles.avatarLetter}>{riderInitials(riderFirst)}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.riderName, { color: colors.ink }]}>{riderFirst}</Text>
              <Text
                style={[styles.riderMeta, { color: colors.inkSecondary }]}
                accessibilityLabel={ratingAvg != null ? `Rider rating ${Number(ratingAvg).toFixed(1)} stars` : 'New rider, no rating yet'}
              >
                {ratingAvg != null ? `★ ${Number(ratingAvg).toFixed(1)}` : '★ New'} · {card.tier === 'wait' ? 'Wait & Save' : card.tier === 'comfort' ? 'Extra Comfort' : card.tier === 'carpool' ? 'Carpool' : 'Standard'}
              </Text>
            </View>
            <OfferGauge gauge={gauge} offerId={card.id} />
            {onFavorite ? (
              <Pressable onPress={onFavorite} accessibilityRole="button" accessibilityLabel={favorite ? 'Remove favorite rider' : 'Save favorite rider'}>
                <Text style={{ color: favorite ? colors.orange : colors.purple, fontWeight: '800' }}>{favorite ? 'Favorite' : 'Save rider'}</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.offerFareRow}>
            <Text style={[styles.offerFare, { color: colors.ink }]} accessibilityLabel={`Driver net pay ${vm.pay.formattedNet}`}>
              {vm.pay.formattedNet}
            </Text>
            <Text style={[styles.offerFareTag, { color: colors.inkSecondary }]}>net</Text>
          </View>
          {tipBoostLine ? (
            <View style={styles.tags} accessibilityLabel={tipBoostLine}>
              <Text style={{ color: colors.ink, fontWeight: '700' }}>{tipBoostLine}</Text>
              <Tag label="Tip boost" tone="purple" />
            </View>
          ) : null}
          <Text style={{ color: colors.inkSecondary }}>
            {vm.pay.subtext}
          </Text>
          <WorthItLegend hourlyCents={hourlyQuote.hourlyCents} colors={colors} />
          {vm.badges.length > 0 ? (
            <View style={styles.tags}>
              {vm.badges.map((b: { id: string; label: string; tone?: 'orange' | 'purple' }) => (
                <Tag key={b.id} label={b.label} tone={b.tone} />
              ))}
            </View>
          ) : null}
          {vm.boostLine ? (
            <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 21 }}>{vm.boostLine}</Text>
          ) : null}
          {preferredNote ? <Text style={{ color: colors.orange, fontWeight: '700' }}>{preferredNote}</Text> : null}
          <CommunityMatchChips supabase={supabase} tripId={card.id} colors={colors} compact />
          <OfferRouteMap
            driver={driver ? { latitude: driver.lat, longitude: driver.lng } : null}
            pickup={pickupPoint}
            dropoff={dropoffPoint}
          />
          <View style={styles.payoutRow}>
            {payoutFigures.map((figure: { id: string; label: string; value: string }) => (
              <Text key={figure.id} style={{ color: figure.id === 'payout' ? colors.ink : colors.inkSecondary, fontWeight: '800' }}>
                {figure.label} · {figure.value}
              </Text>
            ))}
          </View>
          <Text style={{ color: colors.ink, fontWeight: '700' }}>Pickup · {card.pickupLabel}</Text>
          <Text style={{ color: colors.ink, fontWeight: '700' }}>Drop-off · {card.dropoffLabel}</Text>
          {card.airportContext ? (
            <Text style={{ color: colors.purple, fontWeight: '800' }} accessibilityLabel={`Airport: ${card.airportContext.line}`}>
              {card.airportContext.line}
            </Text>
          ) : null}
          {vm.distanceEta ? (
            <Text style={{ color: colors.inkSecondary }}>
              {vm.distanceEta}
            </Text>
          ) : null}
          {vm.pickupAtText ? <Text style={{ color: colors.inkSecondary }}>{vm.pickupAtText}</Text> : null}
          {vm.deposit ? (
            <Text style={{ color: colors.inkSecondary }}>{vm.deposit.label}</Text>
          ) : null}
          {pulsing ? (
            <Animated.Text style={{ color: colors.orange, fontWeight: '800', opacity: glow }}>
              {exclusiveLeft}s to accept
            </Animated.Text>
          ) : poolLeft != null ? (
            <Text style={{ color: colors.purple, fontWeight: '800' }}>
              {poolLeft > 0 ? `Pool · ${poolLeft}s left` : 'Pool offer ended'}
            </Text>
          ) : exclusiveLeft === 0 ? (
            <Text style={{ color: colors.purple, fontWeight: '800' }}>Opening the pool</Text>
          ) : vm.timeLeft?.label ? (
            <Text style={{ color: vm.timeLeft.isUrgent ? colors.orange : colors.inkSecondary, fontWeight: '700' }}>
              {vm.timeLeft.label}
            </Text>
          ) : null}
          {card.comfortStub ? <Text style={{ color: colors.inkSecondary }}>{COMFORT_FLEET_NOTICE}</Text> : null}
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
  topSpacer: { flex: 1 },
  earningsWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  earningsButton: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center' },
  clutter: { gap: GAP },
  demandToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, minHeight: 44,
  },
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
  heatLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  heatToggle: { borderRadius: 999, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
  heatWindows: { paddingHorizontal: 16, gap: 8, marginTop: 10 },
  heatChip: {
    borderRadius: 999, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center',
    borderWidth: 1, borderColor: 'transparent',
  },
  heatChipOn: {
    backgroundColor: PURPLE,
    borderColor: 'rgba(255,255,255,0.16)',
    shadowColor: PURPLE, shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  hotspotRow: { flexGrow: 0, marginTop: 10 },
  hotspots: { paddingHorizontal: 16, gap: 8 },
  hotspot: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  hotspotOn: { color: '#fff', fontWeight: '800' as const },
  hotspotOff: { fontWeight: '800' as const },
  dock: { position: 'absolute', left: EDGE, right: EDGE, gap: GAP, justifyContent: 'flex-end' },
  offerDock: { zIndex: OFFER_CARD_Z, elevation: OFFER_CARD_ELEVATION },
  goRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  goSlot: { alignItems: 'center', gap: 6 },
  goSide: { width: 48, height: 48 },
  onlineStatus: { fontWeight: '700', fontSize: 13, textAlign: 'center' },
  cardTitle: { fontWeight: '800', fontSize: 18 },
  live: { alignSelf: 'stretch', borderRadius: 18, padding: 14, gap: 4 },
  liveKicker: { fontWeight: '800', fontSize: 11, letterSpacing: 1.1 },
  liveTitle: { fontWeight: '800', fontSize: 18 },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  riderName: { fontWeight: '700', fontSize: 16, letterSpacing: -0.3 },
  riderMeta: { fontWeight: '600', fontSize: 13, marginTop: 2, letterSpacing: -0.1 },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(82,45,128,0.28)',
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: '#fff', fontWeight: '700', fontSize: 16, letterSpacing: -0.3 },
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
  declineText: { fontWeight: '700', fontSize: 15, letterSpacing: -0.1 },
  offerWrap: { flexShrink: 1, zIndex: OFFER_CARD_Z, elevation: OFFER_CARD_ELEVATION },
  offerCard: { flexShrink: 1, gap: 0, paddingBottom: 12 },
  offerScroll: { flexGrow: 0, flexShrink: 1 },
  offerBody: { gap: 10, paddingBottom: 2 },
  offerNotice: { fontWeight: '700', fontSize: 13, lineHeight: 18 },
  offerActions: { gap: 8, paddingTop: 10, flexShrink: 0 },
  payoutRow: { gap: 2 },
  docGate: { borderRadius: 16, borderWidth: 1, padding: 12, gap: 4, marginHorizontal: 16, zIndex: DOCUMENT_BANNER_Z, elevation: DOCUMENT_BANNER_ELEVATION },
  docGateTitle: { fontWeight: '800', fontSize: 14, lineHeight: 18 },
  docGateSections: { fontWeight: '700', fontSize: 13, lineHeight: 18 },
  docGateLink: { fontWeight: '800', fontSize: 14 },
  docGateReason: { fontWeight: '600', fontSize: 13, lineHeight: 18 },
  statusWrap: { flexShrink: 1, maxHeight: 400 },
  statusScrollBody: { flexGrow: 1 },
})
