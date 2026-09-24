import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BackButton, Card, ErrorText, Primary } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { supabase } from '@/lib/supabase'
import { loadDriverProfile, loadVehicle, riderFacingCard, setTeslaListing, type FacingCard, type VehicleRow } from 'rides-native/driverDesk'
import { TESLA_FLEET_NOTICE } from 'rides-native/tripTags'
import { INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'

export default function FleetScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { pulse } = useFeedback()
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null)
  const [facing, setFacing] = useState<FacingCard | null>(null)
  const [stubNote, setStubNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const [nextVehicle, profile] = await Promise.all([
      loadVehicle(supabase, user.id),
      loadDriverProfile(supabase, user.id),
    ])
    setVehicle(nextVehicle)
    setFacing(riderFacingCard({ profile, vehicle: nextVehicle, online: true }))
  }, [user])

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load your vehicle'))
  }, [refresh])

  async function toggle(enabled: boolean, claimModel3 = false) {
    if (!user || !supabase) return
    setBusy(true)
    setError(null)
    setStubNote(null)
    try {
      const saved = await setTeslaListing(supabase, user.id, { enabled, claimModel3 })
      setVehicle(saved)
      pulse('online')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the Tesla listing')
    } finally {
      setBusy(false)
    }
  }

  const listed = Boolean(vehicle?.is_tesla)

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <ScrollView contentContainerStyle={styles.list}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.kicker}>FLEET</Text>
        <Text style={styles.title}>Tesla Model 3</Text>
        <Card>
          <Text style={styles.cardTitle}>Self-driving is not live</Text>
          <Text style={styles.copy}>{TESLA_FLEET_NOTICE}</Text>
          <Text style={styles.copy}>
            Riders can pick the Tesla tier in the rider app. If you list one, Pick a driver shows the badge. Accepting that ride means you drive.
          </Text>
        </Card>
        {facing ? (
          <Card>
            <Text style={styles.cardTitle}>How riders see you</Text>
            <Text style={styles.name}>{facing.name}</Text>
            <Text style={styles.copy}>{facing.vehicleLabel}{facing.plate ? ` · ${facing.plate}` : ''}</Text>
            <Text style={styles.copy}>
              {facing.ratingAvg != null ? `${facing.ratingAvg.toFixed(1)} · ${facing.ratingCount} ratings` : 'New driver'}
              {facing.studentVerified ? ' · Clemson student' : ''}
              {facing.isTesla ? ' · Tesla' : ''}
            </Text>
            <Text style={styles.copy}>Go online from home for this card to appear in Pick a driver.</Text>
          </Card>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        {stubNote ? <Text style={styles.stub}>{stubNote}</Text> : null}
        {!vehicle ? (
          <Primary label="Add a vehicle" onPress={() => router.push('/onboarding')} />
        ) : (
          <>
            <Primary
              label={busy ? 'Saving…' : listed ? 'Remove Tesla listing' : 'Show Tesla badge to riders'}
              onPress={() => toggle(!listed, false)}
              disabled={busy}
            />
            {!listed ? (
              <Pressable onPress={() => toggle(true, true)} disabled={busy} style={styles.stubButton}>
                <Text style={styles.stubButtonText}>My car is a Tesla Model 3</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setStubNote('Fleet dispatch is not available. No car was assigned and no self-driving session was started.')}
              style={styles.stubButton}
            >
              <Text style={styles.stubButtonText}>Request a self-driving trip</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  list: { padding: 16, gap: 12, paddingBottom: 40 },
  kicker: { color: ORANGE, fontWeight: '800', letterSpacing: 1.1, fontSize: 12, marginTop: 8 },
  title: { fontSize: 28, fontWeight: '800', color: PURPLE },
  cardTitle: { color: PURPLE, fontWeight: '800', fontSize: 18 },
  name: { color: INK, fontWeight: '800', fontSize: 20 },
  copy: { color: INK_SECONDARY, fontSize: 14, lineHeight: 20 },
  stub: { color: PURPLE, fontWeight: '700', lineHeight: 20 },
  stubButton: { alignItems: 'center', paddingVertical: 12 },
  stubButtonText: { color: ORANGE, fontWeight: '800' },
})
