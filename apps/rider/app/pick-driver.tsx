import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { pressStyle, useEnterMotion } from '@/components/enter'
import { CampusMap } from '@/components/CampusMap'
import { ClemsonLoader } from '@/components/ClemsonLoader'
import type { MapKind } from '@/components/mapTypes'
import { mapKindLabel } from '@/components/mapTypes'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
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
  canFavoriteDriver,
  fetchOnlineDrivers,
  groupDriversForPicker,
  loadFavoriteDriverIds,
  OPEN_POOL_COPY,
  PREFERRED_OFFLINE_COPY,
  requestDriverTrip,
  saveFavoriteDriverIds,
  scheduleRedirectForRequestError,
  sortPreferredDrivers,
  type OnlineDriver,
} from 'rides-native/drivers'
import { destPoint, pickupPoint } from 'rides-native/places.js'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { searchDelayMs } from 'rides-native/riderShell.js'
import { comfortFleetNotice } from 'rides-native/tripTags'
import { loadTigerPass, setFavoriteDrivers, TIGER_PASS_NAME } from 'rides-native/tigerPassClient'

const MAP_KINDS: MapKind[] = ['standard', 'satellite', 'hybrid']
const NOTIFY_KEY = 'rider.notify.driver'

function finiteParam(value: string | string[] | undefined) {
  const raw = oneParam(value).trim()
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export default function PickDriver() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{
    dest?: string
    pickup?: string
    tier?: string
    note?: string
    pickupLat?: string
    pickupLng?: string
    destLat?: string
    destLng?: string
    passengers?: string
  }>()
  const dest = oneParam(params.dest, 'GSP Airport')
  const pickup = oneParam(params.pickup, 'Memorial Stadium')
  const tier = oneParam(params.tier, 'standard')
  const note = oneParam(params.note)
  const passengers = oneParam(params.passengers)
  const pickupLat = finiteParam(params.pickupLat)
  const pickupLng = finiteParam(params.pickupLng)
  const destLat = finiteParam(params.destLat)
  const destLng = finiteParam(params.destLng)
  const approachPickup = pickupLat != null && pickupLng != null
    ? { lat: pickupLat, lng: pickupLng }
    : { lat: pickupPoint(pickup).latitude, lng: pickupPoint(pickup).longitude }
  const dropPoint = destLat != null && destLng != null
    ? { latitude: destLat, longitude: destLng }
    : destPoint(dest)
  const resumeParams = {
    dest,
    pickup,
    tier,
    note,
    pickupLat: oneParam(params.pickupLat),
    pickupLng: oneParam(params.pickupLng),
    destLat: oneParam(params.destLat),
    destLng: oneParam(params.destLng),
  }
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
  const [passPreferredIds, setPassPreferredIds] = useState<string[]>([])
  const [favNote, setFavNote] = useState<string | null>(null)
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const listMotion = useEnterMotion(14)

  useEffect(() => {
    let alive = true
    setPhase('loading')
    setSelected(null)
    const wait = new Promise((resolve) => setTimeout(resolve, searchDelayMs()))
    const favorites = user?.id
      ? loadFavoriteDriverIds(supabase, authStorage, user.id)
      : Promise.resolve({ ids: [] as string[], note: null })
    const pass = user?.id
      ? loadTigerPass(supabase).catch(() => null)
      : Promise.resolve(null)
    Promise.all([fetchOnlineDrivers(supabase), favorites, wait, pass]).then(async ([result, fav, , loadedPass]) => {
      if (!alive) return
      const extraIds = fav.ids.filter((id) => !result.drivers.some((driver) => driver.id === id))
      const extra = extraIds.length
        ? await fetchDriversByIds(supabase, extraIds)
        : { drivers: [] as OnlineDriver[], error: null }
      if (!alive) return
      const merged = sortPreferredDrivers([...result.drivers, ...extra.drivers], fav.ids, approachPickup)
      setDrivers(merged)
      setFavoriteIds(fav.ids)
      setPassPreferredIds(loadedPass?.active ? loadedPass.preferredDriverIds || [] : [])
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
  }, [attempt, pickup, approachPickup.lat, approachPickup.lng, user?.id])

  const selectedDriver = drivers.find((row: OnlineDriver) => row.id === selected) || null
  const comfortNotice = comfortFleetNotice(tier === 'comfort' || tier === 'comfort' || Boolean(selectedDriver?.comfortClass))
  const groups = groupDriversForPicker(
    sortPreferredDrivers(drivers, favoriteIds, approachPickup),
    favoriteIds,
    passPreferredIds.length ? passPreferredIds : undefined,
  )

  async function toggleFavorite(driverId: string) {
    if (!user) {
      setAuthNext({ pathname: '/pick-driver', params: resumeParams })
      setPromptOpen(true)
      return
    }
    if (!canFavoriteDriver(driverId)) {
      setFavNote('Map preview cars cannot be saved.')
      return
    }
    const next = favoriteIds.includes(driverId)
      ? favoriteIds.filter((id: string) => id !== driverId)
      : [...favoriteIds, driverId]
    setFavoriteIds(next)
    const saved = await saveFavoriteDriverIds(supabase, authStorage, user.id, next)
    setFavoriteIds(saved.ids)
    setFavNote(saved.note)
    try {
      const remote = await setFavoriteDrivers(supabase, saved.ids)
      if (Array.isArray(remote?.favoriteDriverIds)) {
        setFavoriteIds(remote.favoriteDriverIds)
        setPassPreferredIds(remote.active ? remote.preferredDriverIds || [] : [])
        if (remote.demoDriversIgnored) setFavNote(remote.demoNote || 'Preview cars were not saved.')
      }
    } catch {
      /* the profile row is already the matching source when the API is down */
    }
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
      <Pressable
        key={driver.id}
        onPress={() => { void tapHaptic(); setSelected(driver.id) }}
        style={({ pressed }) => [styles.card, lift(colors, 'rest'), on && styles.cardOn, !driver.online && styles.cardOff, pressStyle(pressed)]}
        accessibilityRole="button"
        accessibilityLabel={`${driver.name}, ${driver.vehicleLabel}${driver.plate ? `, ${driver.plate}` : ''}. ${eta}`}
        accessibilityHint={driver.online ? 'Selects this driver' : 'This driver is offline'}
        accessibilityState={{ selected: on }}
      >
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
          {driver.comfortClass ? <Text style={styles.badgeOrange}>Comfort</Text> : null}
          {driver.priorityMode && driver.online ? <Text style={styles.badgePurple}>Priority</Text> : null}
          <Pressable
            onPress={() => { void toggleFavorite(driver.id) }}
            hitSlop={16}
            accessibilityRole="button"
            accessibilityLabel={saved ? 'Remove preferred driver' : 'Save preferred driver'}
            accessibilityHint={saved ? 'Removes this driver from your preferred list' : 'Saves this driver as preferred'}
          >
            <Text style={saved ? styles.saveOn : styles.saveOff}>{saved ? 'Saved' : 'Save'}</Text>
          </Pressable>
        </View>
      </Pressable>
    )
  }

  function renderGroups() {
    const passFirst = (groups.passPreferred || []).length > 0
    const blocks = [
      passFirst ? { title: 'Preferred', rows: groups.passPreferred || [] } : null,
      groups.preferred.length ? { title: passFirst ? 'Favorites' : 'Preferred', rows: groups.preferred } : null,
      groups.online.length ? { title: 'Online now', rows: groups.online } : null,
    ].filter((block): block is { title: string; rows: OnlineDriver[] } => Boolean(block))
    return blocks.map((block) => (
      <View key={block.title} style={styles.section}>
        {blocks.length > 1 ? <Text style={styles.sectionTitle}>{block.title}</Text> : null}
        {block.rows.map((driver: OnlineDriver) => renderDriver(driver))}
      </View>
    ))
  }

  const pins = drivers
    .filter((driver: OnlineDriver) => driver.lat != null && driver.lng != null)
    .map((driver: OnlineDriver) => ({
      id: driver.id,
      latitude: Number(driver.lat),
      longitude: Number(driver.lng),
      title: driver.name,
      color: colors.orange,
    }))

  const anyOnline = drivers.some((driver: OnlineDriver) => driver.online)

  const onRequest = async () => {
    const chosen = drivers.find((row: OnlineDriver) => row.id === selected) || null
    if (chosen && !chosen.online) {
      setError('That driver is offline. This request does not auto-match.')
      return
    }
    if (!chosen && !anyOnline) {
      setError('No approved drivers are online right now.')
      return
    }
    if (chosen && tier === 'comfort' && !chosen.comfortClass) {
      setError('Extra Comfort fleet only. That driver is not listed as Comfort.')
      return
    }
    if (!user) {
      setAuthNext({ pathname: '/pick-driver', params: resumeParams })
      setPromptOpen(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const trip = await requestDriverTrip(supabase, {
        riderId: user.id,
        ...(chosen ? { driverId: chosen.id } : { autoAssign: true }),
        dest,
        destPoint: dropPoint,
        pickupLabel: pickup,
        pickupPoint: { latitude: approachPickup.lat, longitude: approachPickup.lng },
        tier,
        ...(passengers ? { passengers } : {}),
        isStudent: student.verified,
        note,
      })
      await successHaptic()
      await playTigerCue()
      router.replace({
        pathname: '/requested',
        params: { dest, trip: trip.id, driver: chosen?.name || 'Next driver' },
      })
    } catch (err) {
      const redirect = scheduleRedirectForRequestError(err, dest)
      if (redirect) {
        router.push(redirect.airport
          ? { pathname: '/schedule', params: { airport: redirect.airport } }
          : '/schedule')
        return
      }
      setError(err instanceof Error ? err.message : 'Could not request that driver')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={[styles.back, lift(colors, 'rest')]}
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityHint="Returns to fare choices"
          hitSlop={8}
        >
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Pick a driver</Text>
          <Text style={styles.sub}>{OPEN_POOL_COPY}</Text>
        </View>
      </View>
      <View style={styles.mapWrap}>
        <CampusMap spots={[]} showHeat={false} mapType={mapType} theater gameDay={false} surge={false} pins={pins} />
        {phase === 'loading' ? (
          <View style={styles.loader} pointerEvents="none">
            <View style={[styles.loaderCard, lift(colors, 'float')]}>
              <ClemsonLoader />
            </View>
          </View>
        ) : null}
        <View style={styles.kinds}>
          {MAP_KINDS.map((kind) => {
            const on = mapType === kind
            return (
              <Pressable
                key={kind}
                onPress={() => setMapType(kind)}
                style={[styles.kind, on && styles.kindOn]}
                accessibilityRole="button"
                accessibilityLabel={`${mapKindLabel(kind)} map`}
                accessibilityHint="Changes the map style"
                accessibilityState={{ selected: on }}
                hitSlop={12}
              >
                <Text style={[styles.kindText, on && styles.kindTextOn]}>{mapKindLabel(kind)}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>
      <Animated.ScrollView style={[styles.listScroll, listMotion]} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {phase === 'results' && !drivers.some((driver: OnlineDriver) => driver.online) ? (
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
            <PrimaryButton label="Retry" tone="ghost" onPress={() => setAttempt((value: number) => value + 1)} />
          </View>
        ) : null}
        {(groups.passPreferred || []).length > 0 ? (
          <Text style={styles.meta}>{TIGER_PASS_NAME} offers preferred drivers first, then your other saved drivers.</Text>
        ) : null}
        {favNote ? <Text style={styles.meta}>{favNote}</Text> : null}
        {phase === 'results' ? renderGroups() : null}
      </Animated.ScrollView>
      <View style={[styles.footer, lift(colors, 'bar'), { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {comfortNotice ? <Text style={styles.comfortNotice}>{comfortNotice}</Text> : null}
        {student.verified && tier === 'standard' ? (
          <Text style={styles.student}>{STUDENT_DISCOUNT_LABEL} is on this request.</Text>
        ) : null}
        {student.verified && tier !== 'standard' ? (
          <Text style={styles.student}>Student pricing is 10% off Standard. This tier stays full price.</Text>
        ) : null}
        {error && drivers.some((driver: OnlineDriver) => driver.online) ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton
          label={busy ? 'Requesting…' : selectedDriver ? `Request ${selectedDriver.name}` : (anyOnline ? 'Request next driver' : 'Select a driver')}
          onPress={onRequest}
          disabled={busy || (selectedDriver ? !selectedDriver.online : !anyOnline)}
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
    header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
    headerCopy: { flex: 1 },
    back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center' as const, justifyContent: 'center' as const },
    backLabel: { fontSize: 18, color: colors.title, fontWeight: '700' as const },
    title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.4, color: colors.title },
    sub: { color: colors.inkSecondary, fontSize: 13, marginTop: 3, lineHeight: 18 },
    mapWrap: { height: 248, marginHorizontal: 20, borderRadius: 22, overflow: 'hidden' as const },
    loader: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 46,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    loaderCard: {
      alignItems: 'center' as const,
      backgroundColor: colors.card,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 22,
      paddingTop: 16,
      paddingBottom: 14,
    },
    kinds: { position: 'absolute' as const, left: 12, bottom: 12, zIndex: 2, flexDirection: 'row' as const, gap: 6 },
    kind: {
      backgroundColor: colors.card,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    kindOn: { backgroundColor: colors.purple, borderColor: colors.purple },
    kindText: { color: colors.link, fontSize: 11, fontWeight: '800' as const },
    kindTextOn: { color: colors.onAccent },
    listScroll: { flex: 1, marginTop: 12 },
    list: { paddingHorizontal: 20, paddingBottom: 16, gap: 10 },
    error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
    empty: { backgroundColor: colors.card, borderRadius: 20, padding: 18, gap: 10, borderWidth: 1, borderColor: colors.border },
    emptyTitle: { fontWeight: '700' as const, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
    section: { gap: 10 },
    sectionTitle: { color: colors.link, fontSize: 13, fontWeight: '700' as const, letterSpacing: 0.2 },
    card: { backgroundColor: colors.card, borderRadius: 18, padding: 16, borderWidth: 1.5, borderColor: colors.border, gap: 6 },
    cardOn: { borderColor: colors.orange, backgroundColor: colors.orangeSoft },
    cardOff: { opacity: 0.72 },
    cardTop: { flexDirection: 'row' as const, gap: 12, alignItems: 'flex-start' as const },
    etaCol: { alignItems: 'flex-end' as const, maxWidth: 120 },
    eta: { color: colors.orange, fontWeight: '800' as const, fontSize: 16 },
    etaOff: { color: colors.inkSecondary },
    name: { fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.2, color: colors.ink },
    meta: { color: colors.link, fontSize: 12, fontWeight: '600' as const },
    badges: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, alignItems: 'center' as const, marginTop: 4 },
    badgeOrange: { color: colors.orange, backgroundColor: colors.orangeSoft, overflow: 'hidden' as const, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: '800' as const },
    badgePurple: { color: colors.link, backgroundColor: colors.purpleSoft, overflow: 'hidden' as const, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: '800' as const },
    saveOn: { color: colors.onAccent, backgroundColor: colors.purple, overflow: 'hidden' as const, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontSize: 12, fontWeight: '800' as const },
    saveOff: { color: colors.orange, fontSize: 12, fontWeight: '800' as const },
    footer: { paddingHorizontal: 20, paddingTop: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
    student: { color: colors.orange, fontWeight: '800' as const, fontSize: 13 },
    comfortNotice: { color: colors.link, fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  }
}
