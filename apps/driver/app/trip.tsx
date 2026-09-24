import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
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
  formatCents,
  preferredRequestNote,
  statusActionLabel,
  statusHeadline,
  tagTone,
  TESLA_FLEET_NOTICE,
  type DriverCard,
} from 'rides-native/tripTags'
import { ORANGE, PURPLE } from 'rides-native/places.js'
import { CounterpartCard, RateTripPanel, partyColorsFromPalette } from 'rides-native/PartyScreens'
import { loadCounterpart, type CounterpartView } from 'rides-native/partyProfile.js'
import { useTheme } from '@/lib/theme'
import type { Palette } from '@/lib/palette'

const STEPS = ['accepted', 'arriving', 'arrived', 'in_progress', 'completed'] as const

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

  const refresh = useCallback(async () => {
    if (!supabase || !id) return
    const row = await loadTrip(supabase, id, user?.id)
    setTrip(row)
    if (row?.riderLat != null && row.riderLng != null) {
      setRider({ latitude: row.riderLat, longitude: row.riderLng })
    }
  }, [id, user?.id])

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load this trip'))
  }, [refresh])

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
    if (!supabase) return undefined
    return subscribeTrips(supabase, () => {
      refresh().catch(() => {})
    })
  }, [refresh])

  useEffect(() => {
    if (!supabase || !id || !trip || trip.status === 'completed' || trip.status === 'canceled') return undefined
    let alive = true
    const pull = () => {
      loadRiderFix(supabase, id).then((fix) => {
        if (alive && fix) setRider({ latitude: fix.latitude, longitude: fix.longitude })
      }).catch(() => {})
    }
    pull()
    const timer = setInterval(pull, 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [id, trip?.status])

  useDriverLocation(Boolean(user && trip && trip.status !== 'completed' && trip.status !== 'canceled'), (fix) => {
    setSelf({ latitude: fix.lat, longitude: fix.lng })
    if (!supabase || !user) return
    publishDriverLocation(supabase, user.id, { ...fix, online: true }).catch(() => {})
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
        setSettleNote(payout?.status
          ? `Fare collected. Payout ${payout.status}${payout.amountCents ? ` · ${formatCents(payout.amountCents)}` : ''}.`
          : 'Fare collected from the rider’s saved card or Apple Pay.')
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
  const route: { latitude: number; longitude: number }[] = []
  if (self) route.push(self)
  if (rider && !headingToDropoff) route.push(rider)
  if (target.latitude != null && target.longitude != null) route.push({ latitude: target.latitude, longitude: target.longitude })
  const focus = rider || (target.latitude != null && target.longitude != null
    ? { latitude: target.latitude, longitude: target.longitude }
    : self)
  const action = trip ? statusActionLabel(trip.status) : null
  const stepIndex = STEPS.indexOf((trip?.status || '') as (typeof STEPS)[number])

  return (
    <View style={styles.screen}>
      <CampusMap pins={pins} center={focus} route={route.length > 1 ? route : undefined} />
      <View pointerEvents="box-none" style={[styles.sheet, shadow, { paddingBottom: insets.bottom + 12 }]}>
        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker} onPress={() => router.back()}>← LIVE TRIP</Text>
        <Text style={styles.title}>{trip ? statusHeadline(trip.status) : 'Loading trip'}</Text>
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
              {trip.tagLabels.map((label) => (
                <Tag key={label} label={label} tone={tagTone(label)} />
              ))}
            </View>
            {preferredRequestNote(trip) ? <Text style={styles.note}>{preferredRequestNote(trip)}</Text> : null}
            <View style={styles.track}>
              {STEPS.map((step, index) => (
                <View key={step} style={[styles.dot, index <= stepIndex && styles.dotOn]} />
              ))}
            </View>
            <FarePanel card={trip} />
            <View style={styles.navRow}>
              {(navApp === 'google' ? ['google', 'apple'] as const : ['apple', 'google'] as const).map((provider) => (
                <Pressable
                  key={provider}
                  onPress={() => openNavigation(provider, target).catch((err) => setError(err instanceof Error ? err.message : 'Could not open maps'))}
                  style={styles.nav}
                >
                  <Text style={styles.navText}>{provider === 'apple' ? 'Apple Maps' : 'Google Maps'}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => router.push({ pathname: '/trip-details', params: { id: trip.id } })}>
              <Text style={styles.settle}>Trip details</Text>
            </Pressable>
            <Text style={styles.copy}>Directions to {headingToDropoff ? 'drop-off' : 'pickup'} · {target.label}</Text>
            {trip.teslaStub ? <Text style={styles.copy}>{TESLA_FLEET_NOTICE}</Text> : null}
            {settleNote ? <Text style={styles.settle}>{settleNote}</Text> : null}
          </>
        ) : (
          <Text style={styles.copy}>{id ? 'This trip is not on your account yet.' : 'Missing trip id.'}</Text>
        )}
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
      padding: 18,
      gap: 8,
      maxHeight: '78%',
    },
    sheetScroll: { flexGrow: 0 },
    sheetContent: { gap: 8, paddingBottom: 8 },
    kicker: { color: colors.orange, fontWeight: '800', letterSpacing: 1 },
    title: { fontSize: 26, fontWeight: '800', color: colors.title },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    note: { color: colors.orange, fontSize: 13, lineHeight: 18, fontWeight: '700' },
    fare: { color: colors.ink, fontWeight: '800', fontSize: 16 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    track: { flexDirection: 'row', gap: 8, marginVertical: 4 },
    dot: { flex: 1, height: 6, borderRadius: 999, backgroundColor: colors.track },
    dotOn: { backgroundColor: colors.orange },
    navRow: { flexDirection: 'row', gap: 8 },
    nav: { flex: 1, backgroundColor: colors.fill, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
    navText: { color: colors.onAccent, fontWeight: '800' },
    settle: { color: colors.title, fontWeight: '700', lineHeight: 20 },
  })
}
