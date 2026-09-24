import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { LiveShareCard } from '@/components/LiveShareCard'
import { SosButton, SosIncomingBanner, SosSheet } from '@/components/SosSheet'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { supabase } from '@/lib/supabase'
import { useTripById } from '@/lib/useRiderTrip'
import { isActiveRideStatus, listEmergencyContacts, type EmergencyContact } from 'rides-native/safety.js'
import { INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'

export default function Requested() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ dest?: string; trip?: string; driver?: string }>()
  const tripId = oneParam(params.trip, '')
  const dest = oneParam(params.dest, '')
  const driver = oneParam(params.driver, 'Your driver')
  const { user } = useAuth()
  const { trip, error, loading } = useTripById(tripId || null)
  const [sosOpen, setSosOpen] = useState(false)
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const rideLive = isActiveRideStatus(trip?.status)
  const shown = trip || (tripId
    ? {
        id: tripId,
        status: null,
        pickup_label: null,
        dropoff_label: dest || null,
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

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>ON TRIP</Text>
          <Text style={styles.title}>Ride requested</Text>
        </View>
        <SosButton onPress={() => setSosOpen(true)} />
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        <SosIncomingBanner tripId={shown?.id || null} userId={user?.id || null} active={rideLive} />
        {!tripId ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No trip to share</Text>
            <Text style={styles.body}>Request a ride from the map. This screen shares your location and SOS once that trip exists.</Text>
          </View>
        ) : (
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>{driver} has the request</Text>
            <Text style={styles.body}>
              {shown?.pickup_label || 'Pickup'} → {shown?.dropoff_label || dest || 'your destination'}
              {shown?.status ? ` · ${shown.status}` : loading ? ' · loading' : ''}
            </Text>
            <Text style={styles.meta}>Trip {tripId.slice(0, 8)}</Text>
            <Text style={styles.body}>Airport holds use the 25% Stripe deposit on Schedule.</Text>
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
            <Text style={styles.body}>Confirm before the alert is sent. 911 is a separate step after that.</Text>
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
  list: { padding: 16, gap: 14, paddingBottom: 32 },
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
