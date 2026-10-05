import { createTrackingRefresh } from 'rides-native/tracking'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CampusMap, type MapPin } from '@/components/CampusMap'
import { FarePanel } from '@/components/FarePanel'
import { ErrorText, Primary, Tag, useCardShadow } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { oneParam } from '@/lib/oneParam'
import { openNavigation } from '@/lib/openMaps'
import { supabase } from '@/lib/supabase'
import { useDriverLocation } from '@/lib/useDriverLocation'
import { advanceTrip, loadRiderFix, loadTrip, publishDriverLocation, subscribeTrips } from 'rides-native/driverDesk'
import {
  driverStatusDetail,
  formatCents,
  preferredRequestNote,
  statusActionLabel,
  statusHeadline,
  tagTone,
  COMFORT_FLEET_NOTICE,
  type DriverCard,
} from 'rides-native/tripTags'
import { DRIVER_TRACK_STEPS, etaHoldLine, etaLineFor, mapRouteCoordinates } from 'rides-native/liveTrip'
import { LivePhase } from 'rides-native/LivePhase'
import { ORANGE, PURPLE } from 'rides-native/places.js'
import { CounterpartCard, RateTripPanel, partyColorsFromPalette } from 'rides-native/PartyScreens'
import { loadCounterpart, type CounterpartView } from 'rides-native/partyProfile.js'
import { useTheme } from '@/lib/theme'
import type { Palette } from '@/lib/palette'

type RiderFix = { latitude: number; longitude: number }

export default function TripScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ id?: string }>()
  const id = oneParam(params.id)
  const { user } = useAuth()
  const { pulse } = useFeedback()
  const { colors, navApp } = useTheme()
  const shadow = useCardShadow()
  const styles = useMemo(() => tripStyles(colors), [colors])
  const [trip, setTrip] = useState<DriverCard | null>(null)
  const [self, setSelf] = useState<{ latitude: number; longitude: number } | null>(null)
  const [rider, setRider] = useState<RiderFix | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settleNote, setSettleNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [person, setPerson] = useState<CounterpartView | null>(null)
  const partyColors = partyColorsFromPalette(colors)

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
        setTrip(row)
        setRider(row?.riderLat != null && row.riderLng != null
          ? { latitude: row.riderLat, longitude: row.riderLng } : null)
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
    if (!supabase || !id || !trip || trip.status === 'completed' || trip.status === 'canceled' || trip.status === 'cancelled_wait') return undefined
    const reader = createTrackingRefresh({
      load: () => loadRiderFix(supabase, id),
      onData: (fix) => setRider(fix ? { latitude: fix.latitude, longitude: fix.longitude } : null),
      onError: () => {},
    })
    void reader.refresh()
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reader.refresh(true)
    })
    const timer = setInterval(() => void reader.refresh(), 5000)
    return () => { reader.stop(); listener.remove(); clearInterval(timer) }
  }, [id, trip?.status])

  const locationTracking = useDriverLocation(Boolean(user && trip && trip.status !== 'completed' && trip.status !== 'canceled' && trip.status !== 'cancelled_wait'), async (fix) => {
    setSelf({ latitude: fix.lat, longitude: fix.lng })
    if (!supabase || !user) return
    await publishDriverLocation(supabase, user.id, { ...fix, online: true })
  })

  async function onAdvance() {
    if (!supabase || !user || !trip) return
    setBusy(true)
    setError(null)
    try {
      const result = await advanceTrip(supabase, trip, user.id)
      if (result?.status === 'completed') {
        pulse('complete')
        const payout = result.settle?.payout
        if (result.settle?.reason === 'no_card_on_file') {
          setSettleNote('Trip complete. No card is on file, so this fare was not charged.')
        } else {
          setSettleNote(payout?.status
            ? `Fare collected. Payout ${payout.status}${payout.amountCents ? ` · ${formatCents(payout.amountCents)}` : ''}.`
            : 'Fare collected from the rider’s saved card or Apple Pay.')
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

  const headingToDropoff = trip?.status === 'in_progress' || trip?.status === 'completed'
  const target = headingToDropoff
    ? { latitude: trip?.dropoffLat ?? null, longitude: trip?.dropoffLng ?? null, label: trip?.dropoffLabel || 'Drop-off' }
    : { latitude: trip?.pickupLat ?? null, longitude: trip?.pickupLng ?? null, label: trip?.pickupLabel || 'Pickup' }

  const pins: MapPin[] = []
  if (self) pins.push({ id: 'me', ...self, title: 'You', pinColor: ORANGE })
  if (rider) pins.push({ id: 'rider', ...rider, title: trip?.firstName || 'Rider', pinColor: PURPLE })
  if (trip?.pickupLat != null && trip.pickupLng != null) {
    pins.push({ id: 'pickup', latitude: trip.pickupLat, longitude: trip.pickupLng, title: trip.pickupLabel, pinColor: PURPLE })
  }
  if (trip?.dropoffLat != null && trip.dropoffLng != null) {
    pins.push({ id: 'drop', latitude: trip.dropoffLat, longitude: trip.dropoffLng, title: trip.dropoffLabel, pinColor: ORANGE })
  }
  const road = mapRouteCoordinates(trip?.routePolyline)
  const straight: { latitude: number; longitude: number }[] = []
  if (self) straight.push(self)
  if (rider && !headingToDropoff) straight.push(rider)
  if (target.latitude != null && target.longitude != null) straight.push({ latitude: target.latitude, longitude: target.longitude })
  const route = road.length > 1 ? road : straight
  const focus = rider || (target.latitude != null && target.longitude != null
    ? { latitude: target.latitude, longitude: target.longitude }
    : self)
  const action = trip ? statusActionLabel(trip.status) : null
  const stepIndex = DRIVER_TRACK_STEPS.findIndex((step) => step.id === trip?.status)
  const etaLine = trip
    ? etaHoldLine(
      trip.status,
      etaLineFor(
        trip.status,
        self ? { lat: self.latitude, lng: self.longitude } : null,
        trip,
      ),
    )
    : null

  return (
    <View style={styles.screen}>
      {/* Road line is the stored Routes polyline when the server had a Maps key. Otherwise the coordinate line stays. */}
      <CampusMap
        pins={pins}
        center={self && !headingToDropoff ? self : focus}
        route={route.length > 1 ? route : undefined}
        showsUserLocation={!headingToDropoff}
      />
      <View pointerEvents="box-none" style={[styles.sheet, shadow, { paddingBottom: insets.bottom + 12, borderColor: colors.border }]}>
        <View style={[styles.handle, { backgroundColor: colors.track }]} />
        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker} onPress={() => router.back()}>← LIVE TRIP</Text>
        <LivePhase
          title={trip ? statusHeadline(trip.status) : 'Loading trip'}
          body={trip ? driverStatusDetail(trip.status) : 'Loading this ride.'}
          eta={locationTracking.error ? null : etaLine}
          steps={DRIVER_TRACK_STEPS}
          activeIndex={stepIndex}
          colors={colors}
        />
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
            <Text style={styles.fare}>{formatCents(trip.driverNetCents)} net · deposit {formatCents(trip.depositCents)}</Text>
            <Text style={styles.copy}>
              {rider ? `${trip.firstName} is sharing a live pin.` : 'Rider pin shows when they share location on this trip. Pickup and drop-off stay on the map.'}
            </Text>
            <View style={styles.tags}>
              {trip.tagLabels.map((label: string) => (
                <Tag key={label} label={label} tone={tagTone(label)} />
              ))}
            </View>
            {preferredRequestNote(trip) ? <Text style={styles.note}>{preferredRequestNote(trip)}</Text> : null}
            <FarePanel card={trip} />
            <View style={styles.navRow}>
              {(navApp === 'google' ? ['google', 'apple'] as const : ['apple', 'google'] as const).map((provider) => (
                <Pressable
                  key={provider}
                  onPress={() => openNavigation(provider, target).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not open maps'))}
                  style={styles.nav}
                  accessibilityRole="button"
                  accessibilityLabel={`Open directions in ${provider === 'apple' ? 'Apple Maps' : 'Google Maps'}`}
                  accessibilityHint={`Opens navigation to ${headingToDropoff ? 'drop-off' : 'pickup'}`}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                >
                  <Text style={styles.navText}>{provider === 'apple' ? 'Apple Maps' : 'Google Maps'}</Text>
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
        {locationTracking.error ? (
            <View>
              <ErrorText>{locationTracking.error}</ErrorText>
              <Primary label="Retry location" onPress={locationTracking.retry} />
            </View>
          ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        {action ? <Primary label={busy ? 'Updating…' : action} onPress={onAdvance} disabled={busy} tone="purple" /> : null}
        </ScrollView>
      </View>
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
    kicker: { color: colors.orange, fontWeight: '800', letterSpacing: 1 },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    note: { color: colors.orange, fontSize: 13, lineHeight: 18, fontWeight: '700' },
    fare: { color: colors.ink, fontWeight: '800', fontSize: 16 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    navRow: { flexDirection: 'row', gap: 8 },
    nav: { flex: 1, backgroundColor: colors.fill, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
    navText: { color: colors.onAccent, fontWeight: '800' },
    settle: { color: colors.title, fontWeight: '700', lineHeight: 20 },
  })
}
