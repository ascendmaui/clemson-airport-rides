import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ListRow, SectionLabel } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { displayFirstName } from 'rides-native/authErrors'
import { loadVehicle, type VehicleRow } from 'rides-native/driverDesk'

function vehicleSubtitle(vehicle: VehicleRow | null): string {
  if (!vehicle) return 'Add your car'
  const name = [vehicle.make, vehicle.model].filter(Boolean).join(' ')
  const plate = vehicle.plate ? ` · ${vehicle.plate}` : ''
  return `${name || 'Vehicle'}${plate}`
}

export default function MenuScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors } = useTheme()
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null)
  const name = user ? displayFirstName(user.user_metadata?.full_name || user.email?.split('@')[0], 'Driver') : 'Guest'

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    setVehicle(await loadVehicle(supabase, user.id))
  }, [user])

  useFocusEffect(useCallback(() => {
    refresh().catch(() => setVehicle(null))
  }, [refresh]))

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={[styles.title, { color: colors.title }]}>{name}</Text>
        <Text style={{ color: colors.inkSecondary }}>{user?.email || 'Sign in to manage driving'}</Text>
        <ListRow icon="gift" title="Refer friends" subtitle="Share Clemson RIDES" onPress={() => router.push('/refer')} />
        <SectionLabel>Manage</SectionLabel>
        <ListRow icon="car" title="Vehicles" subtitle={vehicleSubtitle(vehicle)} onPress={() => router.push('/vehicles')} />
        <ListRow icon="document-text" title="Documents" subtitle="License, insurance, registration" onPress={() => router.push('/documents')} />
        <ListRow icon="shield-checkmark" title="Insurance" subtitle="Coverage notes" onPress={() => router.push('/insurance')} />
        <SectionLabel>Money</SectionLabel>
        <ListRow icon="calculator" title="Tax info" subtitle="W-9 on your application" onPress={() => router.push('/tax')} />
        <ListRow icon="card" title="Payout methods" subtitle="Stripe balance and cash out" onPress={() => router.push('/payouts')} />
        <SectionLabel>Resources</SectionLabel>
        <ListRow icon="school" title="Learning Center" onPress={() => router.push('/learning')} />
        <ListRow icon="bug" title="Bug Reporter" onPress={() => router.push('/bug-report')} />
        <ListRow icon="information-circle" title="About" onPress={() => router.push('/about')} />
        <SectionLabel>Account</SectionLabel>
        <ListRow icon="settings" title="Settings" onPress={() => router.push('/settings')} />
        <ListRow icon="swap-horizontal" title="Switch account" subtitle="One driver session on this phone" onPress={() => router.push('/switch-account')} />
        <ListRow icon="car-sport" title="Tesla Model 3 listing" subtitle="Existing fleet toggle" onPress={() => router.push('/fleet')} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  title: { fontSize: 28, fontWeight: '800' },
})
