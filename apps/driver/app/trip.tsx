import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CampusMap, type MapPin } from '@/components/CampusMap'
import { FarePanel } from '@/components/FarePanel'
import { ErrorText, Primary, Tag, cardShadow } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { oneParam } from '@/lib/oneParam'
import { openNavigation } from '@/lib/openMaps'
import { supabase } from '@/lib/supabase'
import { useDriverLocation } from '@/lib/useDriverLocation'
import { advanceTrip, loadRiderFix, loadTrip, publishDriverLocation, subscribeTrips } from 'rides-native/driverDesk'
import {
  formatCents,
  statusActionLabel,
  statusHeadline,
  TESLA_FLEET_NOTICE,
  type DriverCard,
} from 'rides-native/tripTags'
import { INK, INK_SECONDARY, ORANGE, PURPLE } from 'rides-native/places.js'

const STEPS = ['accepted', 'arriving', 'arrived', 'in_progress', 'completed'] as const

type RiderFix = { latitude: number; longitude: number }

export default function TripScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ id?: string }>()
  const id = oneParam(params.id)
  const { user } = useAuth()
  const { pulse } = useFeedback()
  const [trip, setTrip] = useState<DriverCard | null>(null)
  const [self, setSelf] = useState<{ latitude: number; longitude: number } | null>(null)
  const [rider, setRider] = useState<RiderFix | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settleNote, setSettleNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
      <View pointerEvents="box-none" style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker} onPress={() => router.back()}>← LIVE TRIP</Text>
        <Text style={styles.title}>{trip ? statusHeadline(trip.status) : 'Loading trip'}</Text>
        {trip ? (
          <>
            <Text style={styles.copy}>{trip.pickupLabel} → {trip.dropoffLabel}</Text>
            <Text style={styles.fare}>{formatCents(trip.driverNetCents)} net · deposit {formatCents(trip.depositCents)}</Text>
            <Text style={styles.copy}>
              {rider ? `${trip.firstName} is sharing a live pin.` : 'Rider pin shows when they share location on this trip. Pickup and drop-off stay on the map.'}
            </Text>
            <View style={styles.tags}>
              {trip.tagLabels.map((label) => (
                <Tag key={label} label={label} tone={label.includes('Game') || label.includes('Student') ? 'orange' : 'purple'} />
              ))}
            </View>
            <View style={styles.track}>
              {STEPS.map((step, index) => (
                <View key={step} style={[styles.dot, index <= stepIndex && styles.dotOn]} />
              ))}
            </View>
            <FarePanel card={trip} />
            <View style={styles.navRow}>
              <Pressable onPress={() => openNavigation('apple', target).catch((err) => setError(err instanceof Error ? err.message : 'Could not open Apple Maps'))} style={styles.nav}>
                <Text style={styles.navText}>Apple Maps</Text>
              </Pressable>
              <Pressable onPress={() => openNavigation('google', target).catch((err) => setError(err instanceof Error ? err.message : 'Could not open Google Maps'))} style={styles.nav}>
                <Text style={styles.navText}>Google Maps</Text>
              </Pressable>
            </View>
            <Text style={styles.copy}>Directions to {headingToDropoff ? 'drop-off' : 'pickup'} · {target.label}</Text>
            {trip.teslaStub ? <Text style={styles.copy}>{TESLA_FLEET_NOTICE}</Text> : null}
            {settleNote ? <Text style={styles.settle}>{settleNote}</Text> : null}
          </>
        ) : (
          <Text style={styles.copy}>{id ? 'This trip is not on your account yet.' : 'Missing trip id.'}</Text>
        )}
        {error ? <ErrorText>{error}</ErrorText> : null}
        {action ? <Primary label={busy ? 'Updating…' : action} onPress={onAdvance} disabled={busy} tone="purple" /> : null}
        {trip?.status === 'completed' ? <Primary label="Done" onPress={() => router.replace('/')} /> : null}
        </ScrollView>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F4F0' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 18,
    gap: 8,
    maxHeight: '62%',
    ...cardShadow,
  },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { gap: 8, paddingBottom: 8 },
  kicker: { color: ORANGE, fontWeight: '800', letterSpacing: 1 },
  title: { fontSize: 26, fontWeight: '800', color: PURPLE },
  copy: { color: INK_SECONDARY, fontSize: 14, lineHeight: 20 },
  fare: { color: INK, fontWeight: '800', fontSize: 16 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  track: { flexDirection: 'row', gap: 8, marginVertical: 4 },
  dot: { flex: 1, height: 6, borderRadius: 999, backgroundColor: 'rgba(82,45,128,0.15)' },
  dotOn: { backgroundColor: ORANGE },
  navRow: { flexDirection: 'row', gap: 8 },
  nav: { flex: 1, backgroundColor: PURPLE, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  navText: { color: '#fff', fontWeight: '800' },
  settle: { color: PURPLE, fontWeight: '700', lineHeight: 20 },
})
