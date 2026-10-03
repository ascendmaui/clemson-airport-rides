import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BackButton, Card, ErrorText, Primary } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { loadDriverProfile, loadVehicle, riderFacingCard, type FacingCard, type VehicleRow } from 'rides-native/driverDesk'
import { useTheme } from '@/lib/theme'
import type { Palette } from '@/lib/palette'

export default function FleetScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => fleetStyles(colors), [colors])
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null)
  const [facing, setFacing] = useState<FacingCard | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <ScrollView contentContainerStyle={styles.list}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.kicker}>VEHICLE</Text>
        <Text style={styles.title}>Your car</Text>
        {facing ? (
          <Card>
            <Text style={styles.cardTitle}>How riders see you</Text>
            <Text style={styles.name}>{facing.name}</Text>
            <Text style={styles.copy}>{facing.vehicleLabel}{facing.plate ? ` · ${facing.plate}` : ''}</Text>
            <Text style={styles.copy}>
              {facing.ratingAvg != null ? `${facing.ratingAvg.toFixed(1)} · ${facing.ratingCount} ratings` : 'New driver'}
              {facing.studentVerified ? ' · Clemson student' : ''}
            </Text>
            <Text style={styles.copy}>Go online from home for this card to appear in Pick a driver.</Text>
          </Card>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        {!vehicle ? (
          <Primary label="Add a vehicle" onPress={() => router.push('/onboarding')} />
        ) : null}
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
