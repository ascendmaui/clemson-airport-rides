import { createTrackingRefresh } from 'rides-native/tracking'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CampusMap, type MapPin } from '@/components/CampusMap'
import { WaitTimer } from '@/components/WaitTimer'
import { waitTimerAnchor, type WaitAnchor } from 'rides-native/waitTimer'
import { DriverCancelSheet } from '@/components/DriverCancelSheet'
import { FarePanel } from '@/components/FarePanel'
import { SosButton, SosSheet } from '@/components/SosSheet'
import { ErrorText, Primary, Tag, useCardShadow } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { oneParam } from '@/lib/oneParam'
import { openNavigation } from '@/lib/openMaps'
import { authStorage } from '@/lib/storage'
import { navAppLabel, navAppOrder } from 'rides-native/mapsLink'
import { autoNavigationKey, autoNavigationLeg, readLaunchedLegs, withLaunchedLeg } from 'rides-native/autoNavigation'
import { supabase } from '@/lib/supabase'
import { useDriverLocation } from '@/lib/useDriverLocation'
import { publishDriverLocation, startTripBackgroundLocation, stopTripBackgroundLocation } from '@/lib/backgroundLocation'
import { isActiveTripLocationStatus } from 'rides-native/backgroundLocation'
import { driverTripAction, tripWaitTick, advanceTrip, confirmBackupQueueTrip, loadRiderFix, loadTrip, releaseBackupQueueSeat, subscribeTrips } from 'rides-native/driverDesk'
import {
  arrivedPromptCopy,
  confirmCountdownLabel,
  leaveNowCountdownLabel,
  driverStatusDetail,
  formatCents,
  preferredRequestNote,
  statusActionLabel,
  statusHeadline,
  tagTone,
  toDriverCard,
  COMFORT_FLEET_NOTICE,
  type DriverCard,
} from 'rides-native/tripTags'
import { DRIVER_TRACK_STEPS, etaHoldLine } from 'rides-native/liveTrip'
import { followEtaLine, followMapCoordinates } from 'rides-native/roadFollow'
import { driverPickupTarget } from 'rides-native/riderLivePickup'
import { LivePhase } from 'rides-native/LivePhase'
import { ORANGE, PURPLE } from 'rides-native/places.js'
import { CounterpartCard, RateTripPanel, partyColorsFromPalette } from 'rides-native/PartyScreens'
import { loadCounterpart, type CounterpartView } from 'rides-native/partyProfile.js'
import { useTheme } from '@/lib/theme'
import type { Palette } from '@/lib/palette'
import { TripThread } from 'rides-native/TripThread.jsx'
import { ScheduledRidesHint } from 'rides-native/ScheduledRidesInfo'
import { MAPS_HANDOFF_HELPER } from '../../../shared/copy/scheduledRides.js'
import { isActiveRideStatus } from 'rides-native/safety.js'

type RiderFix = { latitude: number; longitude: number }

function ConfirmCountdown({ closesAt }: { closesAt?: string | null }) {
  const [label, setLabel] = useState<string | null>(() => confirmCountdownLabel(closesAt))
  useEffect(() => {
    const tick = () => setLabel(confirmCountdownLabel(closesAt))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [closesAt])
  if (!label) return null
  return <Text style={{ color: ORANGE, fontWeight: '800', fontSize: 28, marginTop: 6 }}>{label}</Text>
}

function LeaveNowLabel({ leaveNowAt }: { leaveNowAt?: string | null }) {
  const [label, setLabel] = useState<string | null>(() => leaveNowCountdownLabel(leaveNowAt))
  useEffect(() => {
    const tick = () => setLabel(leaveNowCountdownLabel(leaveNowAt))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [leaveNowAt])
  if (!label) return null
  return <Text style={{ color: ORANGE, fontWeight: '800', fontSize: 28, marginTop: 6 }}>{label}</Text>
}

export default function TripScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ id?: string }>()
  const id = oneParam(params.id)
  const { user } = useAuth()
  const { pulse } = useFeedback()
  const { colors, navApp, autoNavigate } = useTheme()
  const shadow = useCardShadow()
  const styles = useMemo(() => tripStyles(colors), [colors])
  const [trip, setTrip] = useState<DriverCard | null>(null)
  const sosActive = isActiveRideStatus(trip?.status)
  const [sosOpen, setSosOpen] = useState(false)
  const terminalTrip = Boolean(trip && ['completed', 'canceled', 'canceled_midride', 'cancelled_wait'].includes(trip.status))
  const activeTrip = isActiveTripLocationStatus(trip?.status)
  const [backgroundNote, setBackgroundNote] = useState<string | null>(null)
  const [self, setSelf] = useState<{ latitude: number; longitude: number } | null>(null)
  const [rider, setRider] = useState<RiderFix | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settleNote, setSettleNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [waitAnchor, setWaitAnchor] = useState<WaitAnchor | null>(null)
  const [waitError, setWaitError] = useState<string | null>(null)
  const [mapsOffer, setMapsOffer] = useState(false)
  const departedTrip = useRef<string | null>(null)
  const [person, setPerson] = useState<CounterpartView | null>(null)
  const partyColors = partyColorsFromPalette(colors)

  useEffect(() => setSosOpen(false), [trip?.id, sosActive])

  const readerRef = useRef<ReturnType<typeof createTrackingRefresh> | null>(null)
  const refresh = useCallback(() => readerRef.current?.refresh(true) ?? Promise.resolve(), [])

  useEffect(() => {
    if (!supabase || !user || !trip?.riderId) {
      setPerson(null)
      return undefined
    }
    let alive = true
    loadCounterpart(supabase, {
      status: trip.status,
      rider_id: trip.riderId,
      driver_id: user.id,
    }, user.id).then((next) => {
      if (alive) setPerson(next)
    }).catch(() => {
      if (alive) setPerson(null)
    })
    return () => {
      alive = false
    }
  }, [trip?.id, trip?.status, trip?.riderId, user?.id])

  useEffect(() => {
    if (!supabase || !id) return undefined
    const reader = createTrackingRefresh({
      load: () => loadTrip(supabase, id, user?.id),
      onData: (row) => {
        if (!row) void stopTripBackgroundLocation(id).catch(() => {})
        // A poll begun before Start or cancel must not restore the wait screen.
        setTrip((current) => current && current.id === row?.id && row?.status === 'arrived'
          && ['in_progress', 'completed', 'canceled', 'canceled_midride', 'cancelled_wait'].includes(current.status)
          ? current : row)
      },
      onError: (err) => setError(err ? (err instanceof Error ? err.message : 'Could not refresh trip. Retrying automatically.') : null),
    })
    readerRef.current = reader
    const pull = () => reader.refresh()
    void pull()
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reader.refresh(true)
    })
    const unsubscribe = subscribeTrips(supabase, pull)
    const timer = setInterval(pull, 5000)
    return () => { reader.stop(); readerRef.current = null; listener.remove(); unsubscribe(); clearInterval(timer) }
  }, [refresh, id, user?.id])

  useEffect(() => {
    if (!trip) return undefined
    let alive = true
    const updateBackgroundLocation = async () => {
      if (!activeTrip || terminalTrip || !user) {
        await stopTripBackgroundLocation(trip.id)
        if (alive) setBackgroundNote(null)
        return
      }
      try {
        const status = await startTripBackgroundLocation(trip.id)
        if (alive) setBackgroundNote(status === 'background-denied'
          ? 'Set location to Always so your rider can still see you while you use Maps.'
          : null)
      } catch {
        if (alive) setBackgroundNote('Background location could not start. Check location in Settings, then return to retry.')
      }
    }
    void updateBackgroundLocation().catch(() => {})
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void updateBackgroundLocation().catch(() => {})
    })
    // Navigation away from this screen must keep an active trip's service alive.
    return () => { alive = false; listener.remove() }
  }, [trip?.id, activeTrip, terminalTrip, user?.id])

  useEffect(() => {
    if (!supabase || !id || !trip || terminalTrip) return undefined
    const reader = createTrackingRefresh({
      load: () => loadRiderFix(supabase, id),
      onData: (fix) => {
        if (!fix) return
        setRider({ latitude: fix.latitude, longitude: fix.longitude })
      },
      onError: () => {},
    })
    void reader.refresh()
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reader.refresh(true)
    })
    const timer = setInterval(() => void reader.refresh(), 5000)
    return () => { reader.stop(); listener.remove(); clearInterval(timer) }
  }, [id, trip?.status, terminalTrip])

  const locationTracking = useDriverLocation(Boolean(user && trip && !terminalTrip), async (fix) => {
    setSelf({ latitude: fix.lat, longitude: fix.lng })
    if (!supabase || !user || !activeTrip) return
    await publishDriverLocation(supabase, user.id, {
      ...fix,
      online: true,
      tripId: trip?.id ?? null,
      tripStatus: trip?.status ?? null,
    })
  })

  function onDriverCanceled() {
    locationTracking.stop()
    pulse('complete')
    router.replace('/')
  }

  async function onAdvance() {
    if (!supabase || !user || !trip || terminalTrip) return
    setBusy(true)
    setError(null)
    try {
      const result = await advanceTrip(supabase, trip, user.id)
      if (result?.status && !isActiveTripLocationStatus(result.status)) {
        await stopTripBackgroundLocation(trip.id)
      }
      if (result?.status === 'cancelled_wait') {
        setTrip(toDriverCard(result, { driverId: user.id }))
      } else if (result?.status === 'completed') {
        pulse('complete')
        const payout = result.settle?.payout
        if (result.settle?.reason === 'no_card_on_file') {
          setSettleNote('Trip complete. No card is on file, so this fare was not charged.')
        } else {
          const waitNote = payout?.waitCents > 0 ? ` Wait time ${formatCents(payout.waitCents)} included.` : ''
          setSettleNote((payout?.status
            ? `Fare collected. Payout ${payout.status}${payout.amountCents ? ` · ${formatCents(payout.amountCents)}` : ''}.`
            : 'Fare collected from the rider’s saved card or Apple Pay.') + waitNote)
        }
      } else {
        pulse('accept')
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this trip')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    setWaitAnchor(null)
    setWaitError(null)
    if (!supabase || !trip || trip.status !== 'arrived') return undefined
    const tripId = trip.id
    let alive = true
    let ticking = false
    const tick = async () => {
      if (ticking) return
      ticking = true
      try {
        const result = await tripWaitTick(supabase, tripId)
        if (!alive) return
        setWaitError(null)
        setWaitAnchor(waitTimerAnchor(result.trip.arrived_at || null, result.serverNow))
        // A slow arrived tick must not undo Start trip or a terminal result.
        setTrip((current) => current?.id === tripId && current.status === 'arrived'
          ? toDriverCard(result.trip, { driverId: user?.id }) : current)
      } catch (err) {
        if (alive) setWaitError(err instanceof Error ? err.message : 'Could not sync wait timer. Retrying automatically.')
      } finally {
        ticking = false
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), 10000)
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void tick()
    })
    return () => { alive = false; clearInterval(timer); listener.remove() }
  }, [trip?.id, trip?.status, trip?.arrivedAt, user?.id])

  async function onNoShow() {
    if (!supabase || !trip || trip.status !== 'arrived' || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await driverTripAction(supabase, trip.id, 'cancel')
      setTrip(toDriverCard(result.trip, { driverId: user?.id }))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel this ride')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const tripId = trip?.id
    const leaveAt = trip?.backupLeaveNowAt
    if (!trip?.backupLeaveNowOpen || !leaveAt || !supabase || !tripId) return undefined
    const dueAt = Date.parse(leaveAt)
    if (!Number.isFinite(dueAt)) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const fire = () => {
      if (departedTrip.current === tripId) return
      departedTrip.current = tripId
      setMapsOffer(true)
      confirmBackupQueueTrip(supabase, tripId, { navigate: true })
        .then(() => refresh())
        .catch((err: unknown) => {
          departedTrip.current = null
          const message = err instanceof Error ? err.message : 'Could not start navigation'
          if (!/changed|Refresh/i.test(message)) setError(message)
          refresh()
        })
    }
    const wait = dueAt - Date.now()
    if (wait <= 0) fire()
    else timer = setTimeout(fire, wait)
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [trip?.backupLeaveNowOpen, trip?.backupLeaveNowAt, trip?.id, supabase, refresh])

  const headingToDropoff = trip?.status === 'in_progress' || trip?.status === 'completed'
  const bookedPickup = driverPickupTarget(trip)
  const livePickup = rider
    ? { latitude: rider.latitude, longitude: rider.longitude, live: true as const }
    : bookedPickup?.live
      ? bookedPickup
      : null
  const target = headingToDropoff
    ? { latitude: trip?.dropoffLat ?? null, longitude: trip?.dropoffLng ?? null, label: trip?.dropoffLabel || 'Drop-off' }
    : livePickup
      ? { latitude: livePickup.latitude, longitude: livePickup.longitude, label: 'Live pickup' }
      : { latitude: trip?.pickupLat ?? null, longitude: trip?.pickupLng ?? null, label: trip?.pickupLabel || 'Pickup' }

  // The 500 m geofence flips accepted → arriving server-side. Tell the driver right away.
  const lastStatus = useRef<string | null>(null)
  useEffect(() => {
    const before = lastStatus.current
    lastStatus.current = trip?.status ?? null
    if (before === 'accepted' && trip?.status === 'arriving') {
      pulse('accept')
      AccessibilityInfo.announceForAccessibility?.('Arrived? Confirm when you are at pickup.')
    }
  }, [trip?.status, pulse])

  const targetRef = useRef(target)
  targetRef.current = target

  // Accept hands off to the driver's nav app for pickup; Start trip hands off for drop-off.
  // Each leg opens once per trip, also across relaunches.
  const autoNavRunning = useRef(false)
  useEffect(() => {
    if (!trip?.id || !autoNavigate || !['accepted', 'arriving', 'in_progress'].includes(trip.status)) return undefined
    if (trip.backupConfirmOpen || trip.backupLeaveNowOpen) return undefined
    let alive = true
    const tripId = trip.id
    const status = trip.status
    void (async () => {
      if (autoNavRunning.current) return
      autoNavRunning.current = true
      try {
        const key = autoNavigationKey(tripId)
        const launched = readLaunchedLegs(await authStorage.getItem(key))
        const leg = autoNavigationLeg({ status, enabled: autoNavigate, launched, acceptedAt: trip.acceptedAt ?? null, pickupAt: trip.pickupAt })
        if (!alive || !leg || AppState.currentState !== 'active') return
        await authStorage.setItem(key, JSON.stringify(withLaunchedLeg(launched, leg)))
        await openNavigation(navApp, targetRef.current)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Could not open maps')
      } finally {
        autoNavRunning.current = false
      }
    })()
    return () => { alive = false }
  }, [trip?.id, trip?.status, autoNavigate, navApp])

  const pins: MapPin[] = []
  if (self) pins.push({ id: 'me', ...self, title: 'You', pinColor: ORANGE })
  if (!headingToDropoff && target.latitude != null && target.longitude != null) {
    pins.push({
      id: 'pickup',
      latitude: target.latitude,
      longitude: target.longitude,
      title: livePickup ? 'Live pickup' : (trip?.pickupLabel || 'Pickup'),
      pinColor: PURPLE,
    })
  } else if (trip?.pickupLat != null && trip.pickupLng != null) {
    pins.push({ id: 'pickup', latitude: trip.pickupLat, longitude: trip.pickupLng, title: trip.pickupLabel, pinColor: PURPLE })
  }
  if (trip?.dropoffLat != null && trip.dropoffLng != null) {
    pins.push({ id: 'drop', latitude: trip.dropoffLat, longitude: trip.dropoffLng, title: trip.dropoffLabel, pinColor: ORANGE })
  }
  const road = followMapCoordinates(
    trip,
    self ? { lat: self.latitude, lng: self.longitude } : null,
  )
  const straight: { latitude: number; longitude: number }[] = []
  if (self) straight.push(self)
  if (rider && !headingToDropoff) straight.push(rider)
  if (target.latitude != null && target.longitude != null) straight.push({ latitude: target.latitude, longitude: target.longitude })
  const route = road.length > 1 ? road : straight
  const focus = rider || (target.latitude != null && target.longitude != null
    ? { latitude: target.latitude, longitude: target.longitude }
    : self)
  const action = trip && !terminalTrip ? statusActionLabel(trip.status) : null
  const stepIndex = DRIVER_TRACK_STEPS.findIndex((step) => step.id === trip?.status)
  const etaLine = trip
    ? etaHoldLine(
      trip.status,
      followEtaLine(
        trip.status,
        self ? { lat: self.latitude, lng: self.longitude } : null,
        trip,
      ),
    )
    : null

  return (
    <View style={styles.screen}>
      {/* Remaining road is the stored polyline when this car is on it. Otherwise the coordinate line stays. */}
      <CampusMap
        pins={pins}
        center={self && !headingToDropoff ? self : focus}
        route={route.length > 1 ? route : undefined}
        showsUserLocation={!headingToDropoff}
      />
      <View pointerEvents="box-none" style={[styles.sheet, shadow, { paddingBottom: insets.bottom + 12, borderColor: colors.border }]}>
        <View style={[styles.handle, { backgroundColor: colors.track }]} />
        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
        <View style={styles.sheetHeader}>
          <Text style={styles.kicker} onPress={() => router.back()}>← LIVE TRIP</Text>
          {sosActive ? <SosButton onPress={() => setSosOpen(true)} /> : null}
        </View>
        <LivePhase
          title={trip ? statusHeadline(trip.status) : 'Loading trip'}
          body={trip ? driverStatusDetail(trip.status) : 'Loading this ride.'}
          eta={etaLine}
          steps={DRIVER_TRACK_STEPS}
          activeIndex={stepIndex}
          colors={colors}
        />
        {trip?.status === 'arriving' ? (() => {
          const prompt = arrivedPromptCopy({ firstName: trip.firstName, pickupLabel: trip.pickupLabel })
          return (
            <View accessibilityRole="summary" style={[styles.arrivePrompt, { borderColor: colors.orange }]}>
              <Text style={styles.arriveTitle}>{prompt.title}</Text>
              <Text style={styles.copy}>{prompt.body}</Text>
              <Primary label={busy ? 'Updating…' : prompt.action} onPress={onAdvance} disabled={busy} tone="orange" />
            </View>
          )
        })() : null}
        {trip ? (
          <>
            {trip.status === 'completed' && user ? (
              <RateTripPanel
                supabase={supabase}
                userId={user.id}
                tripId={trip.id}
                colors={partyColors}
                onDone={() => router.replace('/')}
                onLater={() => router.replace('/')}
              />
            ) : (
              <CounterpartCard person={person} colors={partyColors} />
            )}
            <Text style={styles.copy}>{trip.pickupLabel} → {trip.dropoffLabel}</Text>
            {trip.status === 'cancelled_wait' ? (
              <View accessibilityLabel="Rider no-show result" style={{ gap: 4 }}>
                <Text style={styles.fare}>Rider no-show</Text>
                <Text style={styles.copy}>Rider charged {formatCents(trip.waitFeeCents + trip.cancelFeeCents)}</Text>
                <Text style={styles.fare}>You earn {formatCents(trip.driverWaitEarningsCents)}</Text>
              </View>
            ) : <Text style={styles.fare}>{formatCents(trip.driverNetCents)} net{trip.depositCents ? ` · already paid ${formatCents(trip.depositCents)}` : ''}</Text>}
            {trip.status === 'arrived' ? <WaitTimer arrivedAt={trip.arrivedAt} anchor={waitAnchor} busy={busy} onCancel={onNoShow} /> : null}
            {waitError ? <ErrorText>{waitError}</ErrorText> : null}
            <Text style={styles.copy}>
              {livePickup && !headingToDropoff
                ? `${trip.firstName}'s pickup is live from their phone, within a few feet.`
                : rider
                  ? `${trip.firstName} is sharing a live pin.`
                  : 'Rider pin shows when they share location on this trip. Pickup and drop-off stay on the map.'}
            </Text>
            <View style={styles.tags}>
              {trip.tagLabels.map((label: string) => (
                <Tag key={label} label={label} tone={tagTone(label)} />
              ))}
            </View>
            {preferredRequestNote(trip) ? <Text style={styles.note}>{preferredRequestNote(trip)}</Text> : null}
            {trip.status !== 'cancelled_wait' ? <FarePanel card={trip} /> : null}
            {user ? <TripThread supabase={supabase} tripId={trip.id} userId={user.id} colors={colors} /> : null}
            {trip.backupEnroute || mapsOffer ? <Text style={styles.copy}>{MAPS_HANDOFF_HELPER}</Text> : null}
            <View style={styles.navRow}>
              {navAppOrder(navApp).map((provider, index) => (
                <Pressable
                  key={provider}
                  onPress={() => openNavigation(provider, target).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not open maps'))}
                  style={[styles.nav, index === 0 ? styles.navPrimary : null]}
                  accessibilityRole="button"
                  accessibilityLabel={`Open directions in ${navAppLabel(provider)}`}
                  accessibilityHint={`Opens navigation to ${headingToDropoff ? 'drop-off' : 'pickup'}`}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                >
                  <Text style={styles.navText}>{index === 0 ? `Navigate · ${navAppLabel(provider)}` : navAppLabel(provider)}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => router.push({ pathname: '/trip-details', params: { id: trip.id } })}
              accessibilityRole="button"
              accessibilityLabel="Trip details"
              accessibilityHint="Navigates to detailed trip breakdown and receipt"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.settle}>Trip details</Text>
            </Pressable>
            <Text style={styles.copy}>Directions to {headingToDropoff ? 'drop-off' : 'pickup'} · {target.label}</Text>
            {trip.comfortStub ? <Text style={styles.copy}>{COMFORT_FLEET_NOTICE}</Text> : null}
            {settleNote ? <Text style={styles.settle}>{settleNote}</Text> : null}
          </>
        ) : (
          <Text style={styles.copy}>{id ? 'This trip is not on your account yet.' : 'Missing trip id.'}</Text>
        )}
        {backgroundNote && activeTrip ? (
          <View>
            <Text style={styles.note}>{backgroundNote}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Open location settings"
              onPress={() => { void Linking.openSettings().catch(() => setError('Could not open Settings. Open your phone’s Settings to update location permission.')) }}
              style={styles.nav}>
              <Text style={styles.navText}>Open Settings</Text>
            </Pressable>
          </View>
        ) : null}
        {locationTracking.error ? (
            <View>
              <ErrorText>{locationTracking.error}</ErrorText>
              <Primary label="Retry location" onPress={locationTracking.retry} />
            </View>
          ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        {trip?.backupConfirmOpen ? (
          <View style={{ marginBottom: 12, padding: 12, borderRadius: 14, backgroundColor: 'rgba(245,102,0,0.12)' }}>
            <Text style={{ color: ORANGE, fontWeight: '800', fontSize: 16 }}>Confirm trip</Text>
            <Text style={{ marginTop: 4 }}>{trip.backupConfirmCopy}</Text>
            <ScheduledRidesHint topic="confirm" colors={colors} />
            {trip.backupUrgent ? <Text style={{ color: ORANGE, fontWeight: '700', marginTop: 6 }}>You are up. Confirm and start toward pickup.</Text> : null}
            <ConfirmCountdown closesAt={trip.backupConfirmClosesAt} />
            <Primary
              label={busy ? 'Saving…' : 'Confirm trip'}
              onPress={() => {
                if (!supabase || !trip.id) return
                setBusy(true)
                confirmBackupQueueTrip(supabase, trip.id).then(() => refresh()).catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : 'Could not confirm')
                }).finally(() => setBusy(false))
              }}
              disabled={busy}
            />
            <Primary
              label="Confirm and start navigation"
              onPress={() => {
                if (!supabase || !trip.id) return
                setBusy(true)
                confirmBackupQueueTrip(supabase, trip.id, { navigate: true })
                  .then(() => openNavigation(navApp, target))
                  .then(() => refresh())
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not start navigation'))
                  .finally(() => setBusy(false))
              }}
              disabled={busy}
              tone="purple"
            />
            {trip.backupRole === 'primary' || trip.backupRole === 'backup' ? (
              <Primary
                label={trip.backupRole === 'backup' ? 'Leave backup seat' : 'Can\'t make this trip'}
                onPress={() => {
                  if (!supabase || !trip.id || !trip.backupRole) return
                  setBusy(true)
                  releaseBackupQueueSeat(supabase, trip.id, { role: trip.backupRole })
                    .then(() => refresh())
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not release this seat'))
                    .finally(() => setBusy(false))
                }}
                disabled={busy}
                tone="ghost"
              />
            ) : null}
          </View>
        ) : null}
        {trip?.backupLeaveNowOpen ? (
          <View style={{ marginBottom: 12, padding: 12, borderRadius: 14, backgroundColor: 'rgba(245,102,0,0.12)' }}>
            <Text style={{ color: ORANGE, fontWeight: '800', fontSize: 16 }}>Leave now</Text>
            <ScheduledRidesHint topic="leave" colors={colors} />
            <LeaveNowLabel leaveNowAt={trip.backupLeaveNowAt} />
          </View>
        ) : null}
        {terminalTrip && trip?.status !== 'completed' ? <Primary label="Back to Home" onPress={() => router.replace('/')} tone="purple" /> : null}
        {trip && ['accepted', 'arriving'].includes(trip.status) ? <DriverCancelSheet key={trip.id} supabase={supabase} tripId={trip.id} scheduled={Boolean(trip.pickupAt)} disabled={busy} onCanceled={onDriverCanceled} /> : null}
        {action && trip?.status !== 'arriving' ? <Primary label={busy ? 'Updating…' : action} onPress={onAdvance} disabled={busy} tone="purple" /> : null}
        </ScrollView>
      </View>
      <SosSheet
        open={sosOpen && sosActive}
        onClose={() => setSosOpen(false)}
        trip={trip}
        userId={user?.id ?? null}
        fix={self ? { lat: self.latitude, lng: self.longitude } : null}
      />
    </View>
  )
}

function tripStyles(colors: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderTopWidth: StyleSheet.hairlineWidth,
      padding: 18,
      gap: 8,
      maxHeight: '78%',
    },
    handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 4 },
    sheetScroll: { flexGrow: 0 },
    sheetContent: { gap: 8, paddingBottom: 8 },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    kicker: { color: colors.orange, fontWeight: '800', letterSpacing: 1 },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    note: { color: colors.orange, fontSize: 13, lineHeight: 18, fontWeight: '700' },
    fare: { color: colors.ink, fontWeight: '800', fontSize: 16 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    navRow: { flexDirection: 'row', gap: 8 },
    nav: { flex: 1, backgroundColor: colors.fill, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
    navPrimary: { flex: 2 },
    arrivePrompt: { borderWidth: 2, borderRadius: 18, padding: 14, gap: 8 },
    arriveTitle: { color: colors.title, fontWeight: '900', fontSize: 28 },
    navText: { color: colors.onAccent, fontWeight: '800' },
    settle: { color: colors.title, fontWeight: '700', lineHeight: 20 },
  })
}
