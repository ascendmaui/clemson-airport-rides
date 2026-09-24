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
import {
  describeDriver,
  fetchDriversByIds,
  fetchOnlineDrivers,
  groupDriversForPicker,
  loadFavoriteDriverIds,
  PREFERRED_MATCH_COPY,
  PREFERRED_OFFLINE_COPY,
  requestDriverTrip,
  saveFavoriteDriverIds,
  sortPreferredDrivers,
  type OnlineDriver,
} from 'rides-native/drivers'
import { destPoint, pickupPoint } from 'rides-native/places.js'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { searchDelayMs } from 'rides-native/riderShell.js'
import { teslaFleetNotice } from 'rides-native/tripTags'

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
  const [favoriteIds, setFavoriteIds] = useState<string[]>([])
  const [favNote, setFavNote] = useState<string | null>(null)
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)

  useEffect(() => {
    let alive = true
    setPhase('loading')
    setSelected(null)
    const wait = new Promise((resolve) => setTimeout(resolve, searchDelayMs()))
    const here = pickupPoint(pickup)
    const pickupAt = { lat: here.latitude, lng: here.longitude }
    const favorites = user?.id
      ? loadFavoriteDriverIds(supabase, authStorage, user.id)
      : Promise.resolve({ ids: [] as string[], note: null })
    Promise.all([fetchOnlineDrivers(supabase), favorites, wait]).then(async ([result, fav]) => {
      if (!alive) return
      const extraIds = fav.ids.filter((id) => !result.drivers.some((driver) => driver.id === id))
      const extra = extraIds.length
        ? await fetchDriversByIds(supabase, extraIds)
        : { drivers: [] as OnlineDriver[], error: null }
      if (!alive) return
      const merged = sortPreferredDrivers([...result.drivers, ...extra.drivers], fav.ids, pickupAt)
      setDrivers(merged)
      setFavoriteIds(fav.ids)
      setFavNote(fav.note)
      setError(extra.error || result.error)
      setPhase('results')
      if (merged.some((driver) => driver.online)) {
        await successHaptic()
        await playTigerCue()
      }
    })
    return () => {
      alive = false
    }
  }, [attempt, pickup, user?.id])

  const pickupAt = pickupPoint(pickup)
  const approachPickup = { lat: pickupAt.latitude, lng: pickupAt.longitude }
  const selectedDriver = drivers.find((row) => row.id === selected) || null
  const teslaNotice = teslaFleetNotice(tier === 'tesla' || tier === 'tesla_self_driving' || Boolean(selectedDriver?.isTesla))
  const groups = groupDriversForPicker(sortPreferredDrivers(drivers, favoriteIds, approachPickup), favoriteIds)

  async function toggleFavorite(driverId: string) {
    if (!user) {
      setAuthNext({ pathname: '/pick-driver', params: { dest, pickup, tier } })
      setPromptOpen(true)
      return
    }
    const next = favoriteIds.includes(driverId)
      ? favoriteIds.filter((id) => id !== driverId)
      : [...favoriteIds, driverId]
    setFavoriteIds(next)
    const saved = await saveFavoriteDriverIds(supabase, authStorage, user.id, next)
    setFavoriteIds(saved.ids)
    setFavNote(saved.note)
    await tapHaptic()
  }

  function renderDriver(driver: OnlineDriver) {
    const on = selected === driver.id
    const saved = favoriteIds.includes(driver.id)
    const lines = describeDriver(driver, approachPickup)
    const eta = driver.online
      ? [lines.etaLabel, lines.distanceLabel ? `${lines.distanceLabel} from pickup` : null].filter(Boolean).join(' · ') || 'ETA unavailable'
      : 'Not available now'
    return (
      <Pressable key={driver.id} onPress={() => { void tapHaptic(); setSelected(driver.id) }} style={[styles.card, lift(colors, 'rest'), on && styles.cardOn, !driver.online && styles.cardOff]}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{driver.name}</Text>
            <Text style={styles.sub}>{driver.vehicleLabel}{driver.plate ? ` · ${driver.plate}` : ''}</Text>
          </View>
          <View style={styles.etaCol}>
            <Text style={[styles.eta, !driver.online && styles.etaOff]}>{driver.online ? (lines.etaLabel || 'No ETA') : 'Offline'}</Text>
            <Text style={styles.meta}>{lines.availability}</Text>
          </View>
        </View>
        <Text style={styles.meta}>
          {lines.ratingLabel}
          {driver.standing === 'watch' ? ' · Low rating' : ''}
          {` · ${eta}`}
        </Text>
        <View style={styles.badges}>
          {saved ? <Text style={styles.badgePurple}>Preferred</Text> : null}
          {driver.isTesla ? <Text style={styles.badgeOrange}>Tesla</Text> : null}
          {driver.priorityMode && driver.online ? <Text style={styles.badgePurple}>Priority</Text> : null}
          <Pressable onPress={() => { void toggleFavorite(driver.id) }} hitSlop={8} accessibilityRole="button" accessibilityLabel={saved ? 'Remove preferred driver' : 'Save preferred driver'}>
            <Text style={saved ? styles.saveOn : styles.saveOff}>{saved ? 'Saved' : 'Save'}</Text>
          </Pressable>
        </View>
      </Pressable>
    )
  }

  function renderGroups() {
    const blocks = [
      groups.preferred.length ? { title: 'Preferred', rows: groups.preferred } : null,
      groups.online.length ? { title: 'Online now', rows: groups.online } : null,
    ].filter((block): block is { title: string; rows: OnlineDriver[] } => Boolean(block))
    return blocks.map((block) => (
      <View key={block.title} style={styles.section}>
        {blocks.length > 1 ? <Text style={styles.sectionTitle}>{block.title}</Text> : null}
        {block.rows.map((driver) => renderDriver(driver))}
      </View>
    ))
  }

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
    const chosen = drivers.find((row) => row.id === selected)
    if (!chosen) {
      setError('Select a driver first')
      return
    }
    if (!chosen.online) {
      setError('That driver is offline. This request does not auto-match.')
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
        driverId: chosen.id,
        dest,
        destPoint: destPoint(dest),
        pickupLabel: pickup,
        pickupPoint: pickupPoint(pickup),
        tier,
        isStudent: student.verified,
      })
      await successHaptic()
      await playTigerCue()
      router.replace({
        pathname: '/requested',
        params: { dest, trip: trip.id, driver: chosen.name },
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
          <Text style={styles.sub}>{PREFERRED_MATCH_COPY}</Text>
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
        {phase === 'results' && !drivers.some((driver) => driver.online) ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{drivers.length ? 'Preferred drivers are offline' : 'Still searching'}</Text>
            <Text style={styles.sub}>
              {error || (drivers.length
                ? PREFERRED_OFFLINE_COPY
                : 'No approved driver is online. The orange and purple cars are a preview, not people you can request.')}
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
        {favNote ? <Text style={styles.meta}>{favNote}</Text> : null}
        {phase === 'results' ? renderGroups() : null}
      </ScrollView>
      <View style={styles.footer}>
        {teslaNotice ? <Text style={styles.teslaNotice}>{teslaNotice}</Text> : null}
        {student.verified && tier === 'standard' ? (
          <Text style={styles.student}>{STUDENT_DISCOUNT_LABEL} is on this request.</Text>
        ) : null}
        {student.verified && tier !== 'standard' ? (
          <Text style={styles.student}>Student pricing is 10% off Standard. This tier stays full price.</Text>
        ) : null}
        {error && drivers.some((driver) => driver.online) ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton
          label={busy ? 'Requesting…' : selectedDriver ? `Request ${selectedDriver.name}` : 'Select a driver'}
          onPress={onRequest}
          disabled={busy || !selectedDriver?.online}
        />
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
    section: { gap: 10 },
    sectionTitle: { color: colors.link, fontSize: 12, fontWeight: '800' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const },
    card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: 'transparent', gap: 6 },
    cardOn: { borderColor: colors.orange, backgroundColor: colors.orangeSoft },
    cardOff: { opacity: 0.72 },
    cardTop: { flexDirection: 'row' as const, gap: 12, alignItems: 'flex-start' as const },
    etaCol: { alignItems: 'flex-end' as const, maxWidth: 120 },
    eta: { color: colors.orange, fontWeight: '800' as const, fontSize: 16 },
    etaOff: { color: colors.inkSecondary },
    name: { fontSize: 18, fontWeight: '800' as const, color: colors.ink },
    meta: { color: colors.link, fontSize: 12, fontWeight: '600' as const },
    badges: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, alignItems: 'center' as const, marginTop: 4 },
    badgeOrange: { color: colors.orange, backgroundColor: colors.orangeSoft, overflow: 'hidden' as const, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: '800' as const },
    badgePurple: { color: colors.link, backgroundColor: colors.purpleSoft, overflow: 'hidden' as const, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: '800' as const },
    saveOn: { color: colors.onAccent, backgroundColor: colors.purple, overflow: 'hidden' as const, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontSize: 12, fontWeight: '800' as const },
    saveOff: { color: colors.orange, fontSize: 12, fontWeight: '800' as const },
    footer: { padding: 16, paddingBottom: 28, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
    student: { color: colors.orange, fontWeight: '800' as const, fontSize: 13 },
    teslaNotice: { color: colors.link, fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  }
}
