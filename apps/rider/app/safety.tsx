import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { EmergencyContactsCard } from '@/components/EmergencyContactsCard'
import { LiveShareCard } from '@/components/LiveShareCard'
import { PrimaryButton } from '@/components/Button'
import { SosButton, SosIncomingBanner, SosSheet } from '@/components/SosSheet'
import { useAuth } from '@/lib/auth'
import { useActiveRiderTrip } from '@/lib/useRiderTrip'
import { isActiveRideStatus, type EmergencyContact } from 'rides-native/safety.js'
import { INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'

export default function SafetyScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { trip, error, loading } = useActiveRiderTrip(user?.id || null)
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const [sosOpen, setSosOpen] = useState(false)
  const rideLive = isActiveRideStatus(trip?.status)

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>SAFETY</Text>
          <Text style={styles.title}>Ride with a backup</Text>
        </View>
        <SosButton onPress={() => setSosOpen(true)} />
      </View>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>
          Share a live trip link, confirm an SOS, and keep people you can call on this phone.
        </Text>
        {!user ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Sign in to use Safety</Text>
            <Text style={styles.body}>Live location, SOS logs, and emergency contacts stay on your account.</Text>
            <PrimaryButton label="Sign in" onPress={() => router.push('/sign-in')} />
          </View>
        ) : (
          <>
            <SosIncomingBanner tripId={trip?.id || null} userId={user.id} active={rideLive} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <LiveShareCard trip={trip} userId={user.id} loading={loading} />
            <View style={styles.sosCard}>
              <Text style={styles.kicker}>MID-RIDE</Text>
              <Text style={styles.cardTitle}>SOS</Text>
              {rideLive ? (
                <Text style={styles.body}>
                  This ride is {trip?.status}. SOS asks you to confirm before anyone is called, then logs the alert on the trip.
                </Text>
              ) : (
                <View style={styles.inlineEmpty}>
                  <Text style={styles.emptyTitle}>SOS logging waits for an active ride</Text>
                  <Text style={styles.body}>
                    You can still open SOS to call 911 or Clemson Police. The in-app alert is saved once a driver has accepted.
                  </Text>
                </View>
              )}
              <PrimaryButton label="Open SOS" onPress={() => setSosOpen(true)} tone="purple" />
            </View>
            <EmergencyContactsCard userId={user.id} onContacts={setContacts} />
          </>
        )}
      </ScrollView>
      <SosSheet
        open={sosOpen}
        onClose={() => setSosOpen(false)}
        tripId={trip?.id || null}
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
  title: { color: PURPLE, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  lead: { color: INK_SECONDARY, fontSize: 14, lineHeight: 20 },
  list: { padding: 16, gap: 14, paddingBottom: 32 },
  empty: { backgroundColor: '#fff', borderRadius: 20, padding: 16, gap: 8 },
  emptyTitle: { color: PURPLE, fontWeight: '800', fontSize: 16 },
  body: { color: INK_SECONDARY, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  error: { color: '#B42318', fontSize: 13 },
  sosCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(82,45,128,0.12)',
  },
  cardTitle: { color: PURPLE, fontSize: 20, fontWeight: '800', marginTop: 4, marginBottom: 8 },
  inlineEmpty: { backgroundColor: 'rgba(82,45,128,0.06)', borderRadius: 16, padding: 12, marginBottom: 12 },
})
