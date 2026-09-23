import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { supabase } from '@/lib/supabase'
import { isClemsonEmail } from 'rides-native/authErrors'
import { fetchOnlineDrivers, requestDriverTrip, type OnlineDriver } from 'rides-native/drivers'
import { destPoint, INK, INK_SECONDARY, ORANGE, PURPLE, STADIUM, SURFACE } from 'rides-native/places.js'

export default function PickDriver() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ dest?: string; pickup?: string; tier?: string }>()
  const dest = oneParam(params.dest, 'GSP Airport')
  const pickup = oneParam(params.pickup, 'Memorial Stadium')
  const tier = oneParam(params.tier, 'standard')
  const { user } = useAuth()
  const [drivers, setDrivers] = useState<OnlineDriver[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)

  useEffect(() => {
    let alive = true
    fetchOnlineDrivers(supabase).then((result) => {
      if (!alive) return
      setDrivers(result.drivers)
      setError(result.error)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const onRequest = async () => {
    if (!selected) {
      setError('Select a driver first')
      return
    }
    if (!user) {
      setAuthNext({ pathname: '/pick-driver', params: { dest, pickup, tier } })
      setPromptOpen(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const trip = await requestDriverTrip(supabase, {
        riderId: user.id,
        driverId: selected,
        dest,
        destPoint: destPoint(dest),
        pickupLabel: pickup,
        pickupPoint: STADIUM,
        tier,
        isStudent: isClemsonEmail(user.email),
      })
      const driver = drivers.find((row) => row.id === selected)
      router.replace({
        pathname: '/requested',
        params: { dest, trip: trip.id, driver: driver?.name || 'Driver' },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request that driver')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Pick a driver</Text>
          <Text style={styles.sub}>Live from Supabase driver_status where online = true</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {loading ? <Text style={styles.sub}>Loading online drivers…</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && !error && drivers.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No drivers available</Text>
            <Text style={styles.sub}>When a driver goes online in the driver app, they show up here. No demo fleet.</Text>
          </View>
        ) : null}
        {drivers.map((driver) => {
          const on = selected === driver.id
          return (
            <Pressable key={driver.id} onPress={() => setSelected(driver.id)} style={[styles.card, on && styles.cardOn]}>
              <Text style={styles.name}>{driver.name}</Text>
              <Text style={styles.sub}>{driver.vehicleLabel}</Text>
              <Text style={styles.meta}>
                {driver.ratingAvg != null ? `${driver.ratingAvg.toFixed(1)} · ${driver.ratingCount} ratings` : 'New driver'}
                {driver.standing === 'watch' ? ' · Low rating' : ''}
                {driver.isTesla ? ' · Tesla' : ''}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label={busy ? 'Requesting…' : 'Request this driver'} onPress={onRequest} disabled={busy || !selected} />
      </View>
      <SignInToBookSheet
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        onSignIn={() => {
          setPromptOpen(false)
          router.push('/sign-in')
        }}
        onSignUp={() => {
          setPromptOpen(false)
          router.push('/sign-up')
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  header: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  back: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  backLabel: { fontSize: 18, color: PURPLE, fontWeight: '700' },
  title: { fontSize: 24, fontWeight: '700', color: INK },
  sub: { color: INK_SECONDARY, fontSize: 13, marginTop: 4, lineHeight: 18 },
  list: { padding: 16, gap: 10 },
  error: { color: '#B42318', fontSize: 13, lineHeight: 18 },
  empty: { backgroundColor: '#fff', borderRadius: 20, padding: 24 },
  emptyTitle: { fontWeight: '700', fontSize: 16, color: INK, marginBottom: 6 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'transparent' },
  cardOn: { borderColor: ORANGE },
  name: { fontSize: 18, fontWeight: '800', color: INK },
  meta: { marginTop: 6, color: PURPLE, fontSize: 12, fontWeight: '600' },
  footer: { padding: 16, paddingBottom: 28, backgroundColor: '#fff' },
})
