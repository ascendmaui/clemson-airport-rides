import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { INK, INK_SECONDARY, PURPLE, SURFACE } from 'rides-native/places.js'

type RideRow = {
  id: string
  status: string | null
  pickup_label: string | null
  dropoff_label: string | null
  created_at: string | null
}

export default function HistoryScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const [rows, setRows] = useState<RideRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user || !supabase) return undefined
    let alive = true
    setLoading(true)
    supabase
      .from('trips')
      .select('id, status, pickup_label, dropoff_label, created_at')
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
        <Pressable onPress={() => router.back()} style={styles.back}>
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
          <View key={row.id} style={styles.card}>
            <Text style={styles.cardTitle}>{row.dropoff_label || 'Ride'}</Text>
            <Text style={styles.copy}>{row.pickup_label || 'Pickup'} · {row.status || 'requested'}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  back: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  backLabel: { fontSize: 18, color: PURPLE, fontWeight: '700' },
  title: { fontSize: 24, fontWeight: '800', color: INK },
  list: { padding: 16, gap: 10 },
  copy: { color: INK_SECONDARY, fontSize: 14, lineHeight: 20 },
  error: { color: '#B42318', fontSize: 13 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  cardTitle: { fontWeight: '700', fontSize: 16, color: INK, marginBottom: 4 },
})
