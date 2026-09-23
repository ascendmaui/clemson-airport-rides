import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CampusMap, type MapPin } from '@/components/CampusMap'
import { ErrorText, Primary, Tag, cardShadow } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { supabase } from '@/lib/supabase'
import { useDriverLocation } from '@/lib/useDriverLocation'
import { advanceTrip, loadTrip, publishDriverLocation, subscribeTrips } from 'rides-native/driverDesk'
import {
  formatCents,
  statusActionLabel,
  statusHeadline,
  TESLA_FLEET_NOTICE,
  type DriverCard,
} from 'rides-native/tripTags'
import { INK_SECONDARY, ORANGE, PURPLE } from 'rides-native/places.js'

const STEPS = ['accepted', 'arriving', 'arrived', 'in_progress', 'completed'] as const

export default function TripScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ id?: string }>()
  const id = oneParam(params.id)
  const { user } = useAuth()
  const [trip, setTrip] = useState<DriverCard | null>(null)
  const [self, setSelf] = useState<{ latitude: number; longitude: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!supabase || !id) return
    const row = await loadTrip(supabase, id, user?.id)
    setTrip(row)
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
      await advanceTrip(supabase, trip, user.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this trip')
    } finally {
      setBusy(false)
    }
  }

  const pins: MapPin[] = []
  if (self) pins.push({ id: 'me', ...self, title: 'You', pinColor: ORANGE })
  if (trip?.pickupLat != null && trip.pickupLng != null) {
    pins.push({ id: 'pickup', latitude: trip.pickupLat, longitude: trip.pickupLng, title: trip.pickupLabel, pinColor: PURPLE })
  }
  if (trip?.dropoffLat != null && trip.dropoffLng != null) {
    pins.push({ id: 'drop', latitude: trip.dropoffLat, longitude: trip.dropoffLng, title: trip.dropoffLabel, pinColor: ORANGE })
  }
  const route = pins.filter((pin) => pin.id !== 'me').map((pin) => ({ latitude: pin.latitude, longitude: pin.longitude }))
  const focus = trip?.status === 'in_progress'
    ? (trip.dropoffLat != null && trip.dropoffLng != null ? { latitude: trip.dropoffLat, longitude: trip.dropoffLng } : self)
    : (trip?.pickupLat != null && trip.pickupLng != null ? { latitude: trip.pickupLat, longitude: trip.pickupLng } : self)
  const action = trip ? statusActionLabel(trip.status) : null
  const stepIndex = STEPS.indexOf((trip?.status || '') as (typeof STEPS)[number])

  return (
    <View style={styles.screen}>
      <CampusMap pins={pins} center={focus} route={route} />
      <View pointerEvents="box-none" style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.kicker} onPress={() => router.back()}>← LIVE TRIP</Text>
        <Text style={styles.title}>{trip ? statusHeadline(trip.status) : 'Loading trip'}</Text>
        {trip ? (
          <>
            <Text style={styles.copy}>{trip.pickupLabel} → {trip.dropoffLabel}</Text>
            <Text style={styles.fare}>{formatCents(trip.driverNetCents)} net · deposit {formatCents(trip.depositCents)}</Text>
            <View style={styles.tags}>
              {trip.tagLabels.map((label) => <Tag key={label} label={label} />)}
            </View>
            <View style={styles.track}>
              {STEPS.map((step, index) => (
                <View key={step} style={[styles.dot, index <= stepIndex && styles.dotOn]} />
              ))}
            </View>
            {trip.teslaStub ? <Text style={styles.copy}>{TESLA_FLEET_NOTICE}</Text> : null}
          </>
        ) : (
          <Text style={styles.copy}>{id ? 'This trip is not on your account yet.' : 'Missing trip id.'}</Text>
        )}
        {error ? <ErrorText>{error}</ErrorText> : null}
        {action ? <Primary label={busy ? 'Updating…' : action} onPress={onAdvance} disabled={busy} tone="purple" /> : null}
        {trip?.status === 'completed' ? <Primary label="Done" onPress={() => router.replace('/')} /> : null}
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
    ...cardShadow,
  },
  kicker: { color: ORANGE, fontWeight: '800', letterSpacing: 1 },
  title: { fontSize: 26, fontWeight: '800', color: PURPLE },
  copy: { color: INK_SECONDARY, fontSize: 14, lineHeight: 20 },
  fare: { color: '#0B1220', fontWeight: '800', fontSize: 16 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  track: { flexDirection: 'row', gap: 8, marginVertical: 4 },
  dot: { flex: 1, height: 6, borderRadius: 999, backgroundColor: 'rgba(82,45,128,0.15)' },
  dotOn: { backgroundColor: ORANGE },
})
