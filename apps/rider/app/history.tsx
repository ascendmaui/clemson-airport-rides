import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { isShareableTripStatus } from 'rides-native/safety.js'
import { formatCents } from 'rides-native/tripTags.js'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { RequireAuth } from '@/components/RequireAuth'

type RideRow = {
  id: string
  status: string | null
  pickup_label: string | null
  dropoff_label: string | null
  fare_cents: number | null
  deposit_cents: number | null
  created_at: string | null
  driver_id: string | null
}

function HistoryScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const [rows, setRows] = useState<RideRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)

  useEffect(() => {
    if (!user || !supabase) return undefined
    let alive = true
    setLoading(true)
    supabase
      .from('trips')
      .select('id, status, pickup_label, dropoff_label, fare_cents, deposit_cents, created_at, driver_id')
      .eq('rider_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error: queryError }) => {
        if (!alive) return
        if (queryError) setError(queryError.message)
        else setRows((data || []) as RideRow[])
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [user])

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={[styles.back, lift(colors, 'rest')]}>
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
        <Text style={styles.title}>Your rides</Text>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {!user ? (
          <>
            <Text style={styles.copy}>Sign in to see rides on this account.</Text>
            <PrimaryButton label="Sign in" onPress={() => router.push('/sign-in')} />
          </>
        ) : null}
        {loading ? <Text style={styles.copy}>Loading…</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {user && !loading && !error && rows.length === 0 ? (
          <Text style={styles.copy}>No rides yet. Campus → GSP starts from the map.</Text>
        ) : null}
        {rows.map((row) => (
          <View key={row.id} style={[styles.card, lift(colors, 'rest')]}>
            <Text style={styles.cardTitle}>{row.dropoff_label || 'Ride'}</Text>
            <Text style={styles.copy}>{row.pickup_label || 'Pickup'} · {row.status || 'requested'}</Text>
            <Text style={styles.copy}>Fare {formatCents(row.fare_cents || 0)} · deposit {formatCents(row.deposit_cents || 0)}</Text>
            {row.status === 'completed' && row.driver_id ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Rate this ride"
                accessibilityHint="Opens the rating screen"
                hitSlop={14}
                onPress={() => router.push({ pathname: '/rate', params: { trip: row.id } })}
              >
                <Text style={styles.safety}>Rate this ride</Text>
              </Pressable>
            ) : null}
            {row.status === 'completed' && row.driver_id ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Lost and found"
                accessibilityHint="Reports an item left in the vehicle"
                hitSlop={14}
                onPress={() => router.push({ pathname: '/lost-found', params: { trip: row.id } })}
              >
                <Text style={styles.safety}>Lost & found</Text>
              </Pressable>
            ) : null}
            {isShareableTripStatus(row.status) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share location and SOS"
                accessibilityHint="Opens live trip sharing"
                hitSlop={14}
                onPress={() => router.push({ pathname: '/requested', params: { trip: row.id, dest: row.dropoff_label || '' } })}
              >
                <Text style={styles.safety}>Share location & SOS</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
    back: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center' as const, justifyContent: 'center' as const },
    backLabel: { fontSize: 18, color: colors.title, fontWeight: '700' as const },
    title: { fontSize: 24, fontWeight: '800' as const, color: colors.title },
    list: { padding: 16, gap: 10 },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    error: { color: colors.danger, fontSize: 13 },
    card: { backgroundColor: colors.card, borderRadius: 16, padding: 16 },
    cardTitle: { fontWeight: '700' as const, fontSize: 16, color: colors.ink, marginBottom: 4 },
    safety: { color: colors.orange, fontWeight: '800' as const, marginTop: 8 },
  }
}


export default function HistoryScreenRoute() {
  return (
    <RequireAuth>
      <HistoryScreen />
    </RequireAuth>
  )
}
