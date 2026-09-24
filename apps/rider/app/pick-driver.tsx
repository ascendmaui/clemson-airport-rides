import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
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
import { STUDENT_DISCOUNT_LABEL } from 'rides-native/riderMoney.js'
import { useStudentStatus } from '@/lib/useStudentStatus'
import { fetchOnlineDrivers, requestDriverTrip, type OnlineDriver } from 'rides-native/drivers'
import { destPoint, pickupPoint } from 'rides-native/places.js'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
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
  const student = useStudentStatus()
  const [drivers, setDrivers] = useState<OnlineDriver[]>([])
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'loading' | 'results'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [mapType, setMapType] = useState<MapKind>('standard')
  const [notified, setNotified] = useState(false)
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)

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
      color: colors.orange,
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
        pickupPoint: pickupPoint(pickup),
        tier,
        isStudent: student.verified,
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
        <Pressable onPress={() => router.back()} style={[styles.back, lift(colors, 'rest')]}>
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
            <Pressable key={driver.id} onPress={() => { void tapHaptic(); setSelected(driver.id) }} style={[styles.card, lift(colors, 'rest'), on && styles.cardOn]}>
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
        {student.verified && tier === 'standard' ? (
          <Text style={styles.student}>{STUDENT_DISCOUNT_LABEL} is on this request.</Text>
        ) : null}
        {student.verified && tier !== 'standard' ? (
          <Text style={styles.student}>Student pricing is 10% off Standard. This tier stays full price.</Text>
        ) : null}
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

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row' as const, gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
    back: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center' as const, justifyContent: 'center' as const },
    backLabel: { fontSize: 18, color: colors.title, fontWeight: '700' as const },
    title: { fontSize: 24, fontWeight: '700' as const, color: colors.title },
    sub: { color: colors.inkSecondary, fontSize: 13, marginTop: 4, lineHeight: 18 },
    mapWrap: { height: 280, marginHorizontal: 16, borderRadius: 20, overflow: 'hidden' as const },
    loader: {
      position: 'absolute' as const,
      top: 64,
      left: 36,
      right: 36,
      alignItems: 'center' as const,
      backgroundColor: colors.tabBar,
      borderRadius: 20,
      paddingTop: 12,
      paddingBottom: 14,
      minHeight: 132,
    },
    kinds: { position: 'absolute' as const, left: 10, bottom: 10, flexDirection: 'row' as const, gap: 6 },
    kind: { backgroundColor: colors.card, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
    kindOn: { backgroundColor: colors.purple },
    kindText: { color: colors.link, fontSize: 11, fontWeight: '800' as const },
    kindTextOn: { color: colors.onAccent },
    list: { padding: 16, gap: 10 },
    error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
    empty: { backgroundColor: colors.card, borderRadius: 20, padding: 20, gap: 10 },
    emptyTitle: { fontWeight: '800' as const, fontSize: 18, color: colors.ink },
    card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'transparent' },
    cardOn: { borderColor: colors.orange },
    name: { fontSize: 18, fontWeight: '800' as const, color: colors.ink },
    meta: { marginTop: 6, color: colors.link, fontSize: 12, fontWeight: '600' as const },
    footer: { padding: 16, paddingBottom: 28, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
    student: { color: colors.orange, fontWeight: '800' as const, fontSize: 13 },
  }
}
