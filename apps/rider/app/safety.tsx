import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { EmergencyContactsCard } from '@/components/EmergencyContactsCard'
import { LiveShareCard } from '@/components/LiveShareCard'
import { PrimaryButton } from '@/components/Button'
import { SosButton, SosIncomingBanner, SosSheet } from '@/components/SosSheet'
import { useAuth } from '@/lib/auth'
import { useActiveRiderTrip } from '@/lib/useRiderTrip'
import { isActiveRideStatus, type EmergencyContact } from 'rides-native/safety.js'
import { AudioCaptureCard } from 'rides-native/AudioCaptureCard'
import { SafetyDeck } from 'rides-native/SafetyDeck'
import { VideoCaptureCard } from 'rides-native/VideoCaptureCard'
import { SAFETY_FEATURE_IDS } from '../../../shared/safetyHub.js'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

export default function SafetyScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { trip, error, loading } = useActiveRiderTrip(user?.id || null)
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const [sosOpen, setSosOpen] = useState(false)
  const [feature, setFeature] = useState<(typeof SAFETY_FEATURE_IDS)[number]>('audio')
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const rideLive = isActiveRideStatus(trip?.status)

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={[styles.back, lift(colors, 'rest')]}>
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
          Audio, video, live tracking, and SOS live in this one place. Recording stays on this phone.
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
            <SafetyDeck colors={colors} activeId={feature} onChange={setFeature}>
              <View style={{ display: feature === 'audio' ? 'flex' : 'none' }}>
                <AudioCaptureCard status={trip?.status} colors={colors} />
              </View>
              <View style={{ display: feature === 'video' ? 'flex' : 'none' }}>
                <VideoCaptureCard status={trip?.status} colors={colors} />
              </View>
              <View style={{ display: feature === 'tracking' ? 'flex' : 'none' }}>
                <LiveShareCard trip={trip} userId={user.id} loading={loading} />
              </View>
              <View style={{ display: feature === 'sos' ? 'flex' : 'none', gap: 8 }}>
                {rideLive ? (
                  <Text style={styles.body}>This ride is {trip?.status}. The first press confirms and does not dial.</Text>
                ) : (
                  <Text style={styles.body}>You can call 911 or Clemson Police now. The in-app alert is saved once a driver has accepted.</Text>
                )}
                <PrimaryButton label="Open SOS" onPress={() => setSosOpen(true)} tone="purple" />
                <PrimaryButton label="Call 911" onPress={() => Linking.openURL('tel:911')} />
              </View>
            </SafetyDeck>
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

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
    back: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center' as const, justifyContent: 'center' as const },
    backLabel: { fontSize: 18, color: colors.title, fontWeight: '700' as const },
    headerCopy: { flex: 1 },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.1, fontSize: 11 },
    title: { color: colors.title, fontSize: 22, fontWeight: '800' as const, letterSpacing: -0.3 },
    lead: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    list: { padding: 16, gap: 14, paddingBottom: 32 },
    empty: { backgroundColor: colors.card, borderRadius: 20, padding: 16, gap: 8 },
    emptyTitle: { color: colors.title, fontWeight: '800' as const, fontSize: 16 },
    body: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20, marginBottom: 8 },
    error: { color: colors.danger, fontSize: 13 },
    sosCard: {
      backgroundColor: colors.card,
      borderRadius: 20,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardTitle: { color: colors.title, fontSize: 20, fontWeight: '800' as const, marginTop: 4, marginBottom: 8 },
    inlineEmpty: { backgroundColor: colors.purpleSoft, borderRadius: 16, padding: 12, marginBottom: 12 },
  }
}
