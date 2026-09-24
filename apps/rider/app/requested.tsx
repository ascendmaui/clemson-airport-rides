import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { CampusMap } from '@/components/CampusMap'
import type { MapPin } from '@/components/mapTypes'
import { LiveShareCard } from '@/components/LiveShareCard'
import { SosButton, SosIncomingBanner, SosSheet } from '@/components/SosSheet'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { supabase } from '@/lib/supabase'
import { isLiveStatus, loadLiveTrip, type LiveTrip } from '@/lib/tripWatch'
import { useTripById } from '@/lib/useRiderTrip'
import { isActiveRideStatus, listEmergencyContacts, type EmergencyContact } from 'rides-native/safety.js'
import { INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'
import { CounterpartCard } from 'rides-native/PartyScreens'
import { loadCounterpart, type CounterpartView } from 'rides-native/partyProfile.js'

function pinsFor(trip: LiveTrip | null): MapPin[] {
  if (!trip) return []
  const pins: MapPin[] = []
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
  const params = useLocalSearchParams<{ dest?: string; trip?: string; driver?: string }>()
  const tripId = oneParam(params.trip, '')
  const dest = oneParam(params.dest, '')
  const driver = oneParam(params.driver, 'Your driver')
  const { user } = useAuth()
  const { trip, error: tripError, loading } = useTripById(tripId || null)
  const [live, setLive] = useState<LiveTrip | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [sosOpen, setSosOpen] = useState(false)
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const [person, setPerson] = useState<CounterpartView | null>(null)
  const rideLive = isActiveRideStatus(trip?.status)
  const tracking = isLiveStatus(trip?.status || live?.status || null)
  const located = live?.driverLat != null && live?.driverLng != null
  const driverName = live?.driverName || driver
  const error = tripError || mapError

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
    if (!tripId) return undefined
    void reloadMap()
    const id = setInterval(() => {
      void reloadMap()
    }, 5000)
    return () => clearInterval(id)
  }, [tripId])
  const shown = trip || (tripId
    ? {
        id: tripId,
        status: live?.status ?? null,
        pickup_label: live?.pickup_label ?? null,
        dropoff_label: dest || live?.dropoff_label || null,
        rider_id: user?.id || null,
      }
    : null)

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
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>ON TRIP</Text>
          <Text style={styles.title}>{tracking ? 'Live trip' : 'Ride requested'}</Text>
        </View>
        <SosButton onPress={() => setSosOpen(true)} />
      </View>
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            tintColor={ORANGE}
            onRefresh={() => {
              setRefreshing(true)
              reloadMap().finally(() => setRefreshing(false))
            }}
          />
        )}
      >
        <View style={styles.map}>
          <CampusMap
            spots={[]}
            showHeat={false}
            theater={tracking && !located}
            pins={pinsFor(live)}
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
            <CounterpartCard person={person} />
            {shown?.status === 'completed' ? (
              <PrimaryButton label="Rate your driver" onPress={() => router.push({ pathname: '/rate', params: { trip: tripId } })} />
            ) : null}
            <Text style={styles.summaryTitle}>{driverName} has the request</Text>
            <Text style={styles.body}>
              {shown?.pickup_label || 'Pickup'} → {shown?.dropoff_label || dest || 'your destination'}
              {shown?.status ? ` · ${shown.status}` : loading ? ' · loading' : ''}
            </Text>
            <Text style={styles.meta}>Trip {tripId.slice(0, 8)}</Text>
            <Text style={styles.body}>Airport holds use the 25% Stripe deposit on Schedule.</Text>
            <Text style={styles.body}>
              {located
                ? 'The orange pin is the driver location from driver_status. While they are on the way, a live distance in feet stays on screen and the screen pulses orange as they get closer.'
                : 'Driver coordinates show up here after someone accepts and shares a location. Until then the map stays on campus.'}
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
        <Pressable onPress={() => router.push('/safety')}>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  back: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  backLabel: { fontSize: 18, color: PURPLE, fontWeight: '700' },
  headerCopy: { flex: 1 },
  kicker: { color: ORANGE, fontWeight: '800', letterSpacing: 1.1, fontSize: 11 },
  title: { color: PURPLE, fontSize: 22, fontWeight: '800' },
  list: { padding: 16, gap: 14, paddingBottom: 140 },
  map: { height: 240, borderRadius: 20, overflow: 'hidden' },
  summary: { backgroundColor: '#fff', borderRadius: 20, padding: 16 },
  summaryTitle: { color: INK, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  body: { color: INK_SECONDARY, fontSize: 14, lineHeight: 20 },
  meta: { color: PURPLE, fontWeight: '700', fontSize: 12, marginTop: 8 },
  empty: { backgroundColor: '#fff', borderRadius: 20, padding: 16, gap: 8 },
  emptyTitle: { color: PURPLE, fontWeight: '800', fontSize: 16 },
  inlineEmpty: { backgroundColor: 'rgba(82,45,128,0.06)', borderRadius: 16, padding: 12, marginBottom: 12 },
  error: { color: '#B42318', fontSize: 13 },
  sosCard: { backgroundColor: '#fff', borderRadius: 20, padding: 16 },
  cardTitle: { color: PURPLE, fontSize: 20, fontWeight: '800', marginTop: 4, marginBottom: 8 },
  link: { color: PURPLE, fontWeight: '800', fontSize: 15 },
})
