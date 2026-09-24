import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { CampusMap } from '@/components/CampusMap'
import { ClemsonLoader } from '@/components/ClemsonLoader'
import type { MapKind } from '@/components/mapTypes'
import { mapKindLabel } from '@/components/mapTypes'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { Skeleton } from '@/components/Skeleton'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { playTigerCue, successHaptic, tapHaptic } from '@/lib/feedback'
import { oneParam } from '@/lib/oneParam'
import { authStorage } from '@/lib/storage'
import { supabase } from '@/lib/supabase'
import { isClemsonEmail } from 'rides-native/authErrors'
import { fetchOnlineDrivers, requestDriverTrip, type OnlineDriver } from 'rides-native/drivers'
import { destPoint, INK, INK_SECONDARY, ORANGE, PURPLE, STADIUM, SURFACE } from 'rides-native/places.js'
import { searchDelayMs } from 'rides-native/riderShell.js'

const MAP_KINDS: MapKind[] = ['standard', 'satellite', 'hybrid']
const NOTIFY_KEY = 'rider.notify.driver'

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
  const [phase, setPhase] = useState<'loading' | 'results'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [mapType, setMapType] = useState<MapKind>('standard')
  const [notified, setNotified] = useState(false)

  useEffect(() => {
    let alive = true
    setPhase('loading')
    setSelected(null)
    const wait = new Promise((resolve) => setTimeout(resolve, searchDelayMs()))
    Promise.all([fetchOnlineDrivers(supabase), wait]).then(async ([result]) => {
      if (!alive) return
      setDrivers(result.drivers)
      setError(result.error)
      setPhase('results')
      if (result.drivers.length) {
        await successHaptic()
        await playTigerCue()
      }
    })
    return () => {
      alive = false
    }
  }, [attempt])

  const pins = drivers
    .filter((driver) => driver.lat != null && driver.lng != null)
    .map((driver) => ({
      id: driver.id,
      latitude: Number(driver.lat),
      longitude: Number(driver.lng),
      title: driver.name,
      color: ORANGE,
    }))

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
      await successHaptic()
      await playTigerCue()
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
          <Text style={styles.sub}>Live matches come from drivers who are online. Cars drifting on the map are theater only.</Text>
        </View>
      </View>
      <View style={styles.mapWrap}>
        <CampusMap spots={[]} showHeat={false} mapType={mapType} theater gameDay={false} surge={false} pins={pins} />
        {phase === 'loading' ? (
          <View style={styles.loader}>
            <ClemsonLoader />
          </View>
        ) : null}
        <View style={styles.kinds}>
          {MAP_KINDS.map((kind) => {
            const on = mapType === kind
            return (
              <Pressable key={kind} onPress={() => setMapType(kind)} style={[styles.kind, on && styles.kindOn]}>
                <Text style={[styles.kindText, on && styles.kindTextOn]}>{mapKindLabel(kind)}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {phase === 'loading' ? <Skeleton height={72} /> : null}
        {phase === 'results' && drivers.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Still searching</Text>
            <Text style={styles.sub}>
              {error || 'No approved driver is online. The orange and purple cars are a preview, not people you can request.'}
            </Text>
            <PrimaryButton
              label={notified ? 'Notify me · saved' : 'Notify me'}
              disabled={notified}
              onPress={async () => {
                await authStorage.setItem(NOTIFY_KEY, new Date().toISOString())
                setNotified(true)
                await tapHaptic()
              }}
            />
            <PrimaryButton label="Retry" tone="ghost" onPress={() => setAttempt((value) => value + 1)} />
          </View>
        ) : null}
        {drivers.map((driver) => {
          const on = selected === driver.id
          return (
            <Pressable key={driver.id} onPress={() => { void tapHaptic(); setSelected(driver.id) }} style={[styles.card, on && styles.cardOn]}>
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
  mapWrap: { height: 280, marginHorizontal: 16, borderRadius: 20, overflow: 'hidden' },
  loader: {
    position: 'absolute',
    top: 64,
    left: 36,
    right: 36,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 20,
    paddingTop: 12,
    paddingBottom: 14,
    minHeight: 132,
  },
  kinds: { position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', gap: 6 },
  kind: { backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  kindOn: { backgroundColor: PURPLE },
  kindText: { color: PURPLE, fontSize: 11, fontWeight: '800' },
  kindTextOn: { color: '#fff' },
  list: { padding: 16, gap: 10 },
  error: { color: '#B42318', fontSize: 13, lineHeight: 18 },
  empty: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 10 },
  emptyTitle: { fontWeight: '800', fontSize: 18, color: INK },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'transparent' },
  cardOn: { borderColor: ORANGE },
  name: { fontSize: 18, fontWeight: '800', color: INK },
  meta: { marginTop: 6, color: PURPLE, fontSize: 12, fontWeight: '600' },
  footer: { padding: 16, paddingBottom: 28, backgroundColor: '#fff' },
})
