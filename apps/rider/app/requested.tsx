import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { reconcileCheckout } from 'rides-native/riderMoney.js'
import { AccessibilityInfo, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { HoldExpiryNotice } from '@/components/HoldExpiryNotice'
import { CampusMap } from '@/components/CampusMap'
import type { MapPin } from '@/components/mapTypes'
import { LiveShareCard } from '@/components/LiveShareCard'
import { RideMessages } from '@/components/RideMessages'
import { SosButton, SosIncomingBanner, SosSheet } from '@/components/SosSheet'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { supabase } from '@/lib/supabase'
import { loadLiveTrip, subscribeLiveTrip, type LiveTrip } from '@/lib/tripWatch'
import { useTripById } from '@/lib/useRiderTrip'
import { isActiveRideStatus, listEmergencyContacts, type EmergencyContact } from 'rides-native/safety.js'
import { etaHoldLine, etaLineFor, orderedLiveStops, riderLiveView, SEARCH_PREVIEW_COPY, showSearchTheater, type LiveStopPin } from 'rides-native/liveTrip'
import { holdAirportCode, isOpenUnpaidAirportHold, isUnpaidHoldTtlCancel } from 'rides-native/holdExpiryNotice.js'
import { LivePhase } from 'rides-native/LivePhase'
import { isApproachStatus } from '@/lib/approachAlert'
import { ORANGE, PURPLE } from 'rides-native/places.js'
import { CounterpartCard, partyColorsFromPalette } from 'rides-native/PartyScreens'
import { loadCounterpart, type CounterpartView } from 'rides-native/partyProfile.js'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

function stopColor(stop: LiveStopPin, total: number) {
  if (stop.order === 1) return PURPLE
  if (stop.order === total || stop.kind === 'dropoff') return ORANGE
  return PURPLE
}

function pinsFor(trip: LiveTrip | null): MapPin[] {
  if (!trip) return []
  const pins: MapPin[] = []
  const stops = orderedLiveStops(trip)
  if (stops.length) {
    for (const stop of stops) {
      pins.push({
        id: stop.id,
        latitude: stop.lat,
        longitude: stop.lng,
        title: stop.title,
        color: stopColor(stop, stops.length),
        badge: String(stop.order),
      })
    }
  } else {
    if (trip.pickup_lat != null && trip.pickup_lng != null) {
      pins.push({
        id: 'pickup',
        latitude: trip.pickup_lat,
        longitude: trip.pickup_lng,
        title: trip.pickup_label || 'Pickup',
        color: PURPLE,
      })
    }
    if (trip.dropoff_lat != null && trip.dropoff_lng != null) {
      pins.push({
        id: 'dropoff',
        latitude: trip.dropoff_lat,
        longitude: trip.dropoff_lng,
        title: trip.dropoff_label || 'Drop-off',
        color: ORANGE,
      })
    }
  }
  if (trip.driverLat != null && trip.driverLng != null) {
    pins.push({
      id: 'driver',
      latitude: trip.driverLat,
      longitude: trip.driverLng,
      title: trip.driverName || 'Driver',
      color: ORANGE,
    })
  }
  return pins
}

export default function Requested() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ dest?: string; trip?: string; driver?: string; session_id?: string; sessionId?: string; paid?: string }>()
  const tripId = oneParam(params.trip, '')
  const dest = oneParam(params.dest, '')
  const driver = oneParam(params.driver, 'Your driver')
  const paid = oneParam(params.paid, '')
  const checkoutReturn = paid === '1' || paid === 'true'
  const { user } = useAuth()
  const { trip, error: tripError, loading } = useTripById(tripId || null)
  const [live, setLive] = useState<LiveTrip | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [sosOpen, setSosOpen] = useState(false)
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const [person, setPerson] = useState<CounterpartView | null>(null)
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const rideLive = isActiveRideStatus(trip?.status)
  const located = live?.driverLat != null && live?.driverLng != null
  const driverName = live?.driverName || driver
  const error = tripError || mapError
  const reconciledSessions = useRef(new Set<string>())

  async function reloadMap() {
    if (!tripId) return
    try {
      setLive(await loadLiveTrip(tripId))
      setMapError(null)
    } catch (err) {
      setMapError(err instanceof Error ? err.message : 'Could not load this trip')
    }
  }

  useEffect(() => {
    const sid = params.session_id || params.sessionId
    if (!sid || !supabase || reconciledSessions.current.has(sid)) return
    reconciledSessions.current.add(sid)
    reconcileCheckout(supabase, sid)
      .then(() => {
        void reloadMap()
      })
      .catch((err) => {
        console.warn('[checkout-reconcile] requested reconcile error:', err)
      })
  }, [params.session_id, params.sessionId])

  useEffect(() => {
    if (!tripId) return undefined
    void reloadMap()
    const unsub = subscribeLiveTrip(tripId, live?.driver_id || null, () => {
      void reloadMap()
    })
    const id = setInterval(() => {
      void reloadMap()
    }, 12000)
    return () => {
      unsub()
      clearInterval(id)
    }
  }, [tripId, live?.driver_id])
  const shown = trip || (tripId
    ? {
        id: tripId,
        status: live?.status ?? null,
        pickup_label: live?.pickup_label ?? null,
        dropoff_label: dest || live?.dropoff_label || null,
        rider_id: user?.id || null,
      }
    : null)
  const namedDriver = driver !== 'Your driver'
  const holdTrip = {
    status: trip?.status ?? live?.status ?? null,
    created_at: trip?.created_at ?? live?.created_at ?? null,
    deposit_cents: trip?.deposit_cents ?? live?.deposit_cents ?? null,
    fare_cents: trip?.fare_cents ?? live?.fare_cents ?? null,
    rider_note: trip?.rider_note ?? live?.rider_note ?? null,
    metadata: trip?.metadata ?? live?.metadata ?? null,
  }
  const ttlCanceled = Boolean(tripId) && isUnpaidHoldTtlCancel(holdTrip)
  const preferred = shown?.status === 'requested' || (!shown?.status && namedDriver) || (shown?.status === 'canceled' && namedDriver)
  const requestedAt = live?.requested_at ? new Date(live.requested_at).getTime() : null
  const waitingMs = requestedAt && Number.isFinite(requestedAt) ? Date.now() - requestedAt : 0
  const basePhase = riderLiveView(shown?.status || null, { preferred, waitingMs })
  const phase = ttlCanceled
    ? { ...basePhase, kicker: 'HOLD EXPIRED', title: 'Deposit hold expired', body: '', steps: [], stepIndex: -1 }
    : basePhase
  const etaLine = etaHoldLine(
    shown?.status || null,
    etaLineFor(
      shown?.status || null,
      live?.driverLat != null && live.driverLng != null ? { lat: live.driverLat, lng: live.driverLng } : null,
      live,
    ),
  )
  const preview = showSearchTheater(shown?.status || null)
  const approachLive = isApproachStatus(shown?.status || null)
  const showCheckoutReturn = checkoutReturn
    && Boolean(tripId)
    && !loading
    && (!shown?.status || shown.status === 'searching' || shown.status === 'offered')
  const announcedRideStatus = useRef<string | null>(null)
  const announcedCheckout = useRef(false)

  useEffect(() => {
    const status = shown?.status || null
    if (status !== 'accepted' && status !== 'arriving') {
      announcedRideStatus.current = status
      return
    }
    if (announcedRideStatus.current === status) return
    announcedRideStatus.current = status
    const who = driverName && driverName !== 'Your driver' ? driverName : 'Your driver'
    AccessibilityInfo.announceForAccessibility(
      status === 'accepted'
        ? `${who} is assigned and on the way to pickup.`
        : `${who} is arriving.`,
    )
  }, [shown?.status, driverName])

  useEffect(() => {
    if (!showCheckoutReturn || announcedCheckout.current) return
    announcedCheckout.current = true
    AccessibilityInfo.announceForAccessibility(
      'Stripe Checkout sent you back. This ride is in the open pool. The deposit shows up when Stripe confirms it.',
    )
  }, [showCheckoutReturn])

  useEffect(() => {
    if (!user?.id || !supabase) return undefined
    let alive = true
    listEmergencyContacts(supabase, user.id).then((result) => {
      if (alive) setContacts(result.contacts)
    })
    return () => {
      alive = false
    }
  }, [user?.id])

  useEffect(() => {
    if (!supabase || !user || !shown?.id) return undefined
    let alive = true
    loadCounterpart(supabase, {
      id: shown.id,
      status: shown.status,
      rider_id: shown.rider_id || user.id,
      driver_id: live?.driver_id || trip?.driver_id || null,
    }, user.id).then((next) => {
      if (alive) setPerson(next)
    }).catch(() => {
      if (alive) setPerson(null)
    })
    return () => {
      alive = false
    }
  }, [shown?.id, shown?.status, shown?.rider_id, live?.driver_id, trip?.driver_id, user])

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityHint="Returns to the previous screen"
          hitSlop={8}
          onPress={() => router.back()}
          style={[styles.back, lift(colors, 'rest')]}
        >
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>{ttlCanceled ? 'HOLD EXPIRED' : 'LIVE RIDE'}</Text>
          <Text style={styles.title}>{phase.title}</Text>
          <Text style={styles.kicker}>LIVE RIDE</Text>
          <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">{phase.title}</Text>
        </View>
        <SosButton onPress={() => setSosOpen(true)} />
      </View>
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.orange}
            onRefresh={() => {
              setRefreshing(true)
              reloadMap().finally(() => setRefreshing(false))
            }}
          />
        )}
      >
        {tripId && (ttlCanceled || isOpenUnpaidAirportHold(holdTrip)) ? (
          <HoldExpiryNotice
            trip={holdTrip}
            onRequestAgain={() => {
              const code = holdAirportCode(holdTrip)
              router.push(code ? { pathname: '/schedule', params: { airport: code } } : '/schedule')
            }}
          />
        {showCheckoutReturn ? (
          <Text style={styles.body} accessibilityLiveRegion="polite">
            Stripe Checkout sent you back. This ride is in the open pool. The deposit shows up when Stripe confirms it.
          </Text>
        ) : null}
        <View style={styles.map}>
          {/* TODO: road-following tiles need a billed Maps key. Pins, status, and straight-line ETA use coordinates already on the trip. */}
          <CampusMap
            spots={[]}
            showHeat={false}
            theater={preview && !located}
            pins={pinsFor(live)}
            fitPins
            gameDay={false}
            surge={false}
          />
        </View>
        <SosIncomingBanner tripId={shown?.id || null} userId={user?.id || null} active={rideLive} />
        {!tripId ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No trip to share</Text>
            <Text style={styles.body}>Request a ride from the map. This screen shares your location and SOS once that trip exists.</Text>
          </View>
        ) : (
          <View style={styles.summary}>
            <CounterpartCard person={person} colors={partyColorsFromPalette(colors)} />
            {ttlCanceled ? null : (
              <LivePhase
                kicker={phase.kicker}
                title=""
                body={phase.body}
                eta={etaLine}
                steps={phase.steps}
                activeIndex={phase.stepIndex}
                colors={colors}
              />
            )}
            {approachLive ? (
              <Text style={styles.approach}>
                An orange card tracks how close they are, in feet, from the location they already share.
              </Text>
            ) : null}
            {shown?.status === 'completed' ? (
              <PrimaryButton label="Rate your driver" onPress={() => router.push({ pathname: '/rate', params: { trip: tripId } })} />
            ) : null}
            <Text style={styles.summaryTitle}>{driverName}</Text>
            <Text style={styles.body}>
              {shown?.pickup_label || 'Pickup'} → {shown?.dropoff_label || dest || 'your destination'}
              {loading && !shown?.status ? ' · loading' : ''}
            </Text>
            {orderedLiveStops(live).map((stop) => (
              <Text key={stop.id} style={styles.stopLine}>
                {stop.order} · {stop.label}
              </Text>
            ))}
            <Text style={styles.meta}>Trip {tripId.slice(0, 8)}</Text>
            <Text style={styles.body}>Airport holds use the 25% Stripe deposit on Schedule.</Text>
            {shown?.status === 'completed' ? (
              <PrimaryButton
                label="Lost & found"
                tone="ghost"
                onPress={() => router.push({ pathname: '/lost-found', params: { trip: tripId } })}
              />
            ) : null}
            {user ? <RideMessages tripId={tripId} userId={user.id} /> : null}
            <Text style={styles.body}>
              {preview
                ? SEARCH_PREVIEW_COPY
                : located
                  ? 'The orange pin is the driver location from driver_status. While they are on the way, a live distance in feet stays on screen and the screen pulses orange as they get closer.'
                  : 'Driver coordinates show up here after someone accepts and shares a location. Until then the straight-line ETA stays on this card. Road tiles need a billed Maps key.'}
            </Text>
          </View>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!user ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Sign in to share this ride</Text>
            <Text style={styles.body}>Location links and SOS logs use the same account as the web app.</Text>
            <PrimaryButton label="Sign in" onPress={() => router.push('/sign-in')} />
          </View>
        ) : (
          <LiveShareCard trip={shown} userId={user.id} loading={loading && Boolean(tripId)} />
        )}
        <View style={styles.sosCard}>
          <Text style={styles.kicker}>SOS</Text>
          <Text style={styles.cardTitle}>Need help on this ride?</Text>
          {rideLive ? (
            <Text style={styles.body}>SOS fills the screen in red. The first press confirms and does not dial. Call 911 is the next press.</Text>
          ) : (
            <View style={styles.inlineEmpty}>
              <Text style={styles.emptyTitle}>Waiting for an active ride</Text>
              <Text style={styles.body}>
                SOS is logged once the trip is accepted, arriving, or in progress. You can still open it to call for help.
              </Text>
            </View>
          )}
          <PrimaryButton label="Open SOS" onPress={() => setSosOpen(true)} tone="purple" />
        </View>
        <Pressable
          onPress={() => router.push('/safety')}
          accessibilityRole="button"
          accessibilityLabel="Emergency contacts"
          accessibilityHint="Opens the safety screen"
          hitSlop={16}
        >
          <Text style={styles.link}>Emergency contacts →</Text>
        </Pressable>
        <PrimaryButton label="Back to rides" onPress={() => router.replace('/')} tone="ghost" />
      </ScrollView>
      <SosSheet
        open={sosOpen}
        onClose={() => setSosOpen(false)}
        tripId={shown?.id || null}
        tripStatus={trip?.status || null}
        userId={user?.id || null}
        contacts={contacts}
      />
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
    back: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center' as const, justifyContent: 'center' as const },
    backLabel: { fontSize: 18, color: colors.title, fontWeight: '700' as const },
    headerCopy: { flex: 1 },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.1, fontSize: 11 },
    title: { color: colors.title, fontSize: 22, fontWeight: '800' as const },
    list: { padding: 16, gap: 14, paddingBottom: 140 },
    map: { height: 240, borderRadius: 20, overflow: 'hidden' as const },
    summary: { backgroundColor: colors.card, borderRadius: 20, padding: 16 },
    summaryTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' as const, marginBottom: 6 },
    approach: { color: colors.purple, fontSize: 13, lineHeight: 18, fontWeight: '700' as const, marginTop: 8 },
    body: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    stopLine: { color: colors.ink, fontSize: 14, lineHeight: 20, fontWeight: '700' as const },
    meta: { color: colors.link, fontWeight: '700' as const, fontSize: 12, marginTop: 8 },
    empty: { backgroundColor: colors.card, borderRadius: 20, padding: 16, gap: 8 },
    emptyTitle: { color: colors.title, fontWeight: '800' as const, fontSize: 16 },
    inlineEmpty: { backgroundColor: colors.purpleSoft, borderRadius: 16, padding: 12, marginBottom: 12 },
    error: { color: colors.danger, fontSize: 13 },
    sosCard: { backgroundColor: colors.card, borderRadius: 20, padding: 16 },
    cardTitle: { color: colors.title, fontSize: 20, fontWeight: '800' as const, marginTop: 4, marginBottom: 8 },
    link: { color: colors.link, fontWeight: '800' as const, fontSize: 15 },
  }
}
