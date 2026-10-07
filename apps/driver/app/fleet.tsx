import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BackButton, Card, ErrorText, Primary } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { supabase } from '@/lib/supabase'
import { loadDriverProfile, loadVehicle, riderFacingCard, setServiceClass, type FacingCard, type VehicleRow } from 'rides-native/driverDesk'
import { useTheme } from '@/lib/theme'
import type { Palette } from '@/lib/palette'

export default function FleetScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { pulse } = useFeedback()
  const { colors } = useTheme()
  const styles = useMemo(() => fleetStyles(colors), [colors])
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null)
  const [facing, setFacing] = useState<FacingCard | null>(null)
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
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load your vehicle'))
  }, [refresh])

  async function toggle(enabled: boolean) {
    if (!user || !supabase) return
    setBusy(true)
    setError(null)
    try {
      const saved = await setServiceClass(supabase, user.id, { enabled })
      setVehicle(saved)
      pulse('online')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the Comfort listing')
    } finally {
      setBusy(false)
    }
  }

  const service = String(vehicle?.service_class ?? '').trim().toLowerCase()
  const listed = service === 'comfort' || service === 'true' || String(vehicle?.tier || '').trim().toLowerCase() === 'comfort'

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <ScrollView contentContainerStyle={styles.list}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.kicker}>FLEET</Text>
        <Text style={styles.title}>Extra Comfort</Text>
        <Card>
          <Text style={styles.cardTitle}>Comfort listing</Text>
          <Text style={styles.copy}>
            Show the Extra Comfort badge in Pick a driver when this car should take those trips.
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
              {listed ? ' · Comfort' : ''}
            </Text>
            <Text style={styles.copy}>Go online from home for this card to appear in Pick a driver.</Text>
          </Card>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        {!vehicle ? (
          <Primary label="Add a vehicle" onPress={() => router.push('/onboarding')} />
        ) : (
          <Primary
            label={busy ? 'Saving…' : listed ? 'Remove Comfort listing' : 'Show Comfort badge to riders'}
            onPress={() => toggle(!listed)}
            disabled={busy}
          />
        )}
      </ScrollView>
    </View>
  )
}

function fleetStyles(colors: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    list: { padding: 16, gap: 12, paddingBottom: 40 },
    kicker: { color: colors.orange, fontWeight: '800', letterSpacing: 1.1, fontSize: 12, marginTop: 8 },
    title: { fontSize: 28, fontWeight: '800', color: colors.title },
    cardTitle: { color: colors.title, fontWeight: '800', fontSize: 18 },
    name: { color: colors.ink, fontWeight: '800', fontSize: 20 },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
  })
}
