import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CampusMap, type MapPin } from '@/components/CampusMap'
import { FarePanel } from '@/components/FarePanel'
import { Card, ErrorText, Primary, Tag, useCardShadow } from '@/components/chrome'
import { CircleButton, GoButton } from '@/components/shell'
import { DriverStatusCard } from '@/components/DriverStatusCard'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { notifyAcceptedRide, setRideAlertSurface } from '@/lib/push'
import { shownCents } from '@/lib/shown'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { driverPresence, goOffline, goOnline, usePresence } from '@/lib/presence'
import { fetchDriverApplication } from 'rides-native/drivers'
import { displayFirstName } from 'rides-native/authErrors'
import { heatColor } from 'rides-native/heat.js'
import { HEAT_WINDOWS } from 'rides-native/places.js'
import { loadBusySpots, type BusySpot } from '@/lib/busySpots'
import {
  acceptTrip,
  declineDriverOffer,
  markSearchingOffers,
  formatCents,
  loadDriverDesk,
  loadGameDay,
  loadEarnings,
  publishDriverCapacity,
  setPriorityMode,
  subscribeTrips,
  type DriverDesk,
} from 'rides-native/driverDesk'
import {
  acceptActionLabel,
  declineActionLabel,
  declineDisposition,
  formatPickupAt,
  preferredRequestNote,
  statusHeadline,
  tagTone,
  COMFORT_FLEET_NOTICE,
  weekNetCents,
  type DriverCard,
} from 'rides-native/tripTags'
import { etaHoldLine } from 'rides-native/liveTrip'
import { followEtaLine } from 'rides-native/roadFollow'
import { driverPickupTarget } from 'rides-native/riderLivePickup'
import { ORANGE, PURPLE } from 'rides-native/places.js'
import { gameDayNotice, type GameDayNotice } from 'rides-native/gameDayNotice.js'
import { approvalGateMessage, isSyntheticOffer } from 'rides-native/syntheticOffers'
import { driverGateView } from 'rides-native/driverGateView'
import { loadCounterpart } from 'rides-native/partyProfile.js'
import { offerCardViewModel } from 'rides-native/offerCard'
import { EXCLUSIVE_SECONDS, exclusiveSecondsLeft, formatHourlyRate, offerHourly, poolSecondsLeft } from 'rides-native/offerLadder.js'

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
  const { colors, scheme, earningsPrivate, setEarningsPrivate, autoAccept, setAutoAccept } = useTheme()
  const shadow = useCardShadow()
  const { user, configured } = useAuth()
  const { pulse } = useFeedback()
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
  const [focusToken, setFocusToken] = useState(0)
  const [showHeat, setShowHeat] = useState(true)
  const [heatWindow, setHeatWindow] = useState('now')
  const [spots, setSpots] = useState<BusySpot[]>([])
  const [heatCaption, setHeatCaption] = useState('Popular campus spots from ride requests.')
  const [heatBlended, setHeatBlended] = useState(false)
  const [heatLoading, setHeatLoading] = useState(true)
  const [riderLine, setRiderLine] = useState<string | null>(null)
  const [hiddenOffers, setHiddenOffers] = useState<string[]>([])
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null)
  const [gameNotice, setGameNotice] = useState<GameDayNotice | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const gate = useMemo(
    () => driverGateView(status, { rejectionReason: reason }),
    [status, reason]
  )
  const canSeeOffers = gate.canSeeOffers
  const canGoOnline = gate.canGoOnline
  const approved = status === 'approved'
  const online = Boolean(desk?.online)
  const barY = useRef(new Animated.Value(120)).current
  useEffect(() => {
    setRideAlertSurface({ online })
    Animated.timing(barY, { toValue: online ? 0 : 120, duration: 280, useNativeDriver: true }).start()
  }, [barY, online])
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
    } else {
      setDesk(null)
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
    if (!user) {
      router.push('/sign-in')
      return
    }
    if (!canGoOnline) {
      setError(gate.body)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const nextOnline = !online
      const fix = nextOnline ? await currentFix() : null
      if (nextOnline) await goOnline(user.id, fix)
      else await goOffline(user.id)
      if (fix) setSelf({ latitude: fix.lat, longitude: fix.lng })
      if (nextOnline) {
        await publishDriverCapacity(supabase, user.id, desk?.vehicle?.seats)
        setFocusToken((value: number) => value + 1)
      }
      pulse('online')
      AccessibilityInfo.announceForAccessibility(nextOnline ? 'You are now online' : 'You are now offline')
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
      await declineDriverOffer(supabase, card, user.id)
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

  const liveOffers = (canSeeOffers ? desk?.offers || [] : []).filter(
    (card: DriverCard) => !isSyntheticOffer(card) && !hiddenOffers.includes(card.id),
  )
  const offer = liveOffers.find((card: DriverCard) => card.id === selectedOfferId) || liveOffers[0] || null
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
  if (self) pins.push({ id: 'me', ...self, title: 'You', pinColor: ORANGE, kind: 'self' })
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

  const statusLine = !user
    ? 'Sign in to drive'
    : !canGoOnline
      ? gate.title
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
        heatWindow={heatWindow}
        gameDay={Boolean(gameNotice?.live)}
        gameDayLabel={gameNotice?.live ? gameNotice.headline : null}
        lockOnCenter={Boolean(online && self)}
        onPinPress={onPinPress}
      />
      <View pointerEvents="box-none" style={styles.overlay}>
        <View style={[styles.top, { paddingTop: dockTop }]} pointerEvents="box-none">
          <CircleButton icon="home" label="Menu" onPress={() => router.push('/menu')} />
          <Pressable
            onPress={() => setPeek((open: boolean) => !open)}
            style={[styles.pill, shadow, { backgroundColor: colors.card }]}
            accessibilityRole="button"
            accessibilityLabel="Earnings"
            accessibilityHint="Expands today's and this week's earnings preview"
            accessibilityState={{ expanded: peek }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.pillText, { color: colors.title }]}>{shownCents(todayCents, earningsPrivate)}</Text>
            <Text style={{ color: colors.inkSecondary, fontWeight: '800' }}>{peek ? '▴' : '▾'}</Text>
          </Pressable>
          <CircleButton icon="search" label="Discover" onPress={() => router.push('/discover')} />
        </View>

        {peek ? (
          <View style={[styles.peek, shadow, { backgroundColor: colors.card }]}>
            <View style={styles.peekHead}>
              <Pressable
                onPress={() => setEarningsPrivate(!earningsPrivate)}
                accessibilityRole="button"
                accessibilityLabel={earningsPrivate ? 'Show earnings' : 'Hide earnings'}
                accessibilityHint="Toggles visibility of earnings amounts"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={{ color: colors.title, fontWeight: '800' }}>{earningsPrivate ? 'Show' : 'Hide'}</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push('/learning')}
                accessibilityRole="button"
                accessibilityLabel="Help"
                accessibilityHint="Opens driver learning center"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
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
                <Pressable
                  key={page}
                  onPress={() => setPeekPage(page)}
                  accessibilityRole="button"
                  accessibilityLabel={page === 0 ? "Today's earnings" : "This week's earnings"}
                  accessibilityState={{ selected: page === peekPage }}
                  hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                  style={[styles.dot, { backgroundColor: page === peekPage ? colors.orange : colors.track }]}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.heatPanel}>
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
            {heatLoading ? 'Loading campus demand…' : showHeat ? `${heatCaption}${heatBlended ? ' · Live + typical' : ''}` : 'Busy areas are hidden.'}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hotspots} style={styles.hotspotRow}>
            <View style={[styles.hotspot, { backgroundColor: gameNotice?.live ? colors.orange : colors.card }]}>
              <Text style={[gameNotice?.live ? styles.hotspotOn : styles.hotspotOff, gameNotice?.live ? null : { color: colors.purple }]}>
                {gameNotice == null ? 'Game day…' : gameNotice.headline}
              </Text>
            </View>
            {hotspots.map((spot: BusySpot) => (
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
          {locationTracking.error ? (
            <View>
              <ErrorText>{locationTracking.error}</ErrorText>
              <Primary label="Retry location" onPress={locationTracking.retry} />
            </View>
          ) : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          {!canSeeOffers ? (
            <ScrollView
              style={styles.statusWrap}
              contentContainerStyle={styles.statusScrollBody}
              showsVerticalScrollIndicator={false}
              alwaysBounceVertical={true}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onPullRefresh}
                  tintColor={colors.orange}
                  title="Checking application status…"
                  titleColor={colors.inkSecondary}
                  accessibilityLabel="Pull to refresh application status"
                />
              }
            >
              <DriverStatusCard
                status={status}
                gate={gate}
                reason={reason}
                onRefresh={onPullRefresh}
                refreshing={refreshing}
              />
            </ScrollView>
          ) : null}
          {desk?.active ? (
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
          {offer && !desk?.active ? (
            <RideCard
              card={offer}
              busy={busy}
              notice={null}
              driver={liveFrom ? { lat: liveFrom.lat, lng: liveFrom.lng } : null}
              favorite={Boolean(offer.riderId && autoAccept.favoriteRiders.some((rider) => rider.id === offer.riderId))}
              onFavorite={() => {
                if (!offer.riderId) return
                const next = autoAccept.favoriteRiders.filter((rider) => rider.id !== offer.riderId)
                setAutoAccept({
                  favoriteRiders: autoAccept.favoriteRiders.some((rider) => rider.id === offer.riderId)
                    ? next
                    : [{ id: offer.riderId, name: offer.firstName }, ...autoAccept.favoriteRiders].slice(0, 50),
                })
              }}
              onAccept={() => onAccept(offer)}
              onDecline={() => onDecline(offer)}
            />
          ) : null}
          <View style={styles.controls} pointerEvents="box-none">
            <View style={styles.toolCol}>
              <CircleButton icon="shield" label="Safety" onPress={() => router.push('/safety')} />
              <CircleButton icon="sparkles" label="Priority mode" onPress={onPriority} />
            </View>
            <GoButton
              online={online}
              busy={busy}
              disabled={!canGoOnline}
              disabledReason={gate.body}
              onPress={toggle}
            />
            <View style={styles.toolCol}>
              <CircleButton icon="stats-chart" label="Earnings" onPress={() => router.push('/earnings')} />
              <CircleButton icon="locate" label="Recenter map" onPress={() => setFocusToken((value: number) => value + 1)} />
            </View>
          </View>
          <Animated.View
            style={[styles.bar, shadow, { backgroundColor: colors.card, transform: [{ translateY: barY }] }]}
            accessibilityLiveRegion="polite"
            accessibilityElementsHidden={!online}
            pointerEvents={online ? 'auto' : 'none'}
          >
            <CircleButton icon="options" label="Ride queue" onPress={() => router.push('/queue')} />
            <Text style={[styles.barText, { color: colors.title }]} accessibilityLiveRegion="polite">{online ? statusLine : ''}</Text>
            <CircleButton icon="list" label="Open queue" onPress={() => router.push('/queue')} />
          </Animated.View>
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
  const seenAt = useRef(Date.now())
  useEffect(() => {
    seenAt.current = Date.now()
  }, [card.id])
  const waitingOnPool = card.offerPhase === 'pool' || card.offerPhase === 'scheduled' || card.status === 'scheduled'
  const exclusiveLeft = waitingOnPool
    ? null
    : (exclusiveSecondsLeft(card, tick) ?? Math.max(0, EXCLUSIVE_SECONDS - Math.round((tick - seenAt.current) / 1000)))
  const poolLeft = poolSecondsLeft(card, tick)
  const secondsLeft = exclusiveLeft ?? poolLeft
  const pulsing = exclusiveLeft != null && exclusiveLeft > 0
  const vm = offerCardViewModel(secondsLeft == null ? card : { ...card, secondsLeft })
  const hourly = formatHourlyRate(offerHourly(card, driver).hourlyCents)
  const preferredNote = preferredRequestNote(card)
  const opacity = useState(() => new Animated.Value(0))[0]
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
    Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }).start()
  }, [opacity])
  useEffect(() => {
    if (!pulsing) {
      glow.setValue(1)
      return undefined
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0.35, duration: 700, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [glow, pulsing])
  useEffect(() => {
    // Hint that the breakdown scrolls when the card had to shrink to fit.
    if (overflows) scrollRef.current?.flashScrollIndicators()
  }, [overflows, card.id])
  return (
    // flexShrink lets the dock squeeze the card to the room left above the controls;
    // only the details scroll — Accept / Decline stay pinned and visible.
    <Animated.View style={[styles.offerWrap, { opacity }]}>
      <Card
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
            {card.riderAvatarUrl ? (
              <Image
                source={{ uri: card.riderAvatarUrl }}
                style={styles.avatar}
                accessibilityIgnoresInvertColors
                accessibilityLabel={`${card.firstName || 'Rider'} profile photo`}
              />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.purple }]}>
                <Text style={styles.avatarLetter}>{(card.firstName || 'R').slice(0, 1)}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16 }}>{card.firstName}</Text>
              <Text style={{ color: colors.inkSecondary }}>{card.tier === 'wait' ? 'Wait & Save' : card.tier === 'comfort' ? 'Extra Comfort' : card.tier === 'carpool' ? 'Carpool' : 'Standard'}</Text>
            </View>
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
          <Text style={{ color: colors.inkSecondary }}>
            {vm.pay.subtext}
          </Text>
          <Text style={{ color: colors.orange, fontWeight: '800' }} accessibilityLabel={`Hourly rate ${hourly}`}>
            {hourly}
          </Text>
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
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: '#fff', fontWeight: '800', fontSize: 18 },
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
  statusWrap: { flexShrink: 1, maxHeight: 400 },
  statusScrollBody: { flexGrow: 1 },
})
