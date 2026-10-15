import { Glyph } from 'rides-native/icons'
import { useDemoBusyRoster } from '@/lib/useDemoBusyRoster'
import { busyRosterFor } from 'rides-native/busyRoster.js'
import { resolveDriverPortrait } from '../../../shared/driverPortrait.js'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState, type ReactNode } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { DenseText } from '@/components/DenseText'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { FlowErrorBoundary } from '@/components/FlowErrorBoundary'
import { TipBoostPicker } from '@/components/TipBoostPicker'
import { pressStyle, useEnterMotion } from '@/components/enter'
import { CampusMap } from '@/components/CampusMap'
import { ClemsonLoader } from '@/components/ClemsonLoader'
import type { MapKind } from '@/components/mapTypes'
import { mapKindLabel } from '@/components/mapTypes'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { playDriverBrowseCue, playDriverFoundCue, tapHaptic } from '@/lib/feedback'
import { oneParam } from '@/lib/oneParam'
import { authStorage } from '@/lib/storage'
import { supabase } from '@/lib/supabase'
import { STUDENT_DISCOUNT_LABEL } from 'rides-native/riderMoney.js'
import { useStudentStatus } from '@/lib/useStudentStatus'
import {
  EMPTY_FAVORITES_COPY,
  FAVORITE_ACCOUNT_SAVE_ERROR,
  FAVORITE_PERSIST_ERROR,
  fetchDriversByIds,
  canFavoriteDriver,
  fetchOnlineDrivers,
  filterDriversForFleet,
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
import { logCaught } from '@/lib/caught'
import { pickerDriverCard, readablePickerDrivers, rosterCard, sanitizeOnlineDrivers, textField } from '@/lib/driverFields'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { searchDelayMs } from 'rides-native/riderShell.js'
import { comfortFleetNotice } from 'rides-native/tripTags'
import { loadTigerPass, setFavoriteDrivers, TIGER_PASS_NAME } from 'rides-native/tigerPassClient'
import { paymentMethodRequiredError, riderPaymentMethodReady } from '../../../shared/ridePaymentReady.js'
import { applePaySetUp } from '@/lib/applePayReady'

const MAP_KINDS: MapKind[] = ['standard', 'satellite', 'hybrid']
const NOTIFY_KEY = 'rider.notify.driver'

type DriverGroups = {
  passPreferred?: OnlineDriver[]
  preferred: OnlineDriver[]
  online: OnlineDriver[]
}

/** Sort and section the roster. A row that throws while sorting stays in an unsorted section. */
function groupedPickerDrivers(
  drivers: OnlineDriver[],
  favoriteIds: string[],
  approachPickup: { lat: number; lng: number },
  passPreferredIds: string[],
): DriverGroups {
  const pass = passPreferredIds.length ? passPreferredIds : undefined
  try {
    return groupDriversForPicker(sortPreferredDrivers(drivers, favoriteIds, approachPickup), favoriteIds, pass)
  } catch (err) {
    logCaught('pick-driver-group', err)
  }
  try {
    return groupDriversForPicker(drivers, favoriteIds, pass)
  } catch (err) {
    logCaught('pick-driver-group', err)
    return { preferred: [], online: drivers }
  }
}

/**
 * Driver cards live in their own child so a bad row is caught here.
 * The map and the request footer stay on screen. Try again remounts the list.
 */
function DriverRoster({
  phase,
  drivers,
  passPreferredIds,
  error,
  notified,
  favNote,
  favoriteIds,
  selected,
  approachPickup,
  extra,
  onSelect,
  onToggleFavorite,
  onNotify,
  onRetry,
}: {
  phase: 'loading' | 'results'
  drivers: OnlineDriver[]
  passPreferredIds: string[]
  error: string | null
  notified: boolean
  favNote: string | null
  favoriteIds: string[]
  selected: string | null
  approachPickup: { lat: number; lng: number }
  extra: ReactNode
  onSelect: (id: string) => void
  onToggleFavorite: (id: string) => void
  onNotify: () => void
  onRetry: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const listMotion = useEnterMotion(14)
  const groups = groupedPickerDrivers(drivers, favoriteIds, approachPickup, passPreferredIds)

  function renderDriver(driver: OnlineDriver) {
    const card = pickerDriverCard(driver, approachPickup, favoriteIds.includes(textField(driver?.id, '')))
    if (!card) return null
    const on = selected === card.id
    return (
      <View key={card.id} style={[styles.card, lift(colors, 'rest'), on && styles.cardOn, !card.online && styles.cardOff]}>
        <Pressable
          onPress={() => onSelect(card.id)}
          style={({ pressed }) => pressStyle(pressed)}
          accessibilityRole="button"
          accessibilityLabel={`${card.name}, ${card.vehicleLabel}${card.plate ? `, ${card.plate}` : ''}. ${card.eta}`}
          accessibilityHint={card.online ? 'Selects this driver' : 'This driver is offline'}
          accessibilityState={{ selected: on }}
        >
          <View style={styles.cardTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{card.name}</Text>
              <Text style={styles.sub}>{card.vehicleLabel}{card.plate ? ` · ${card.plate}` : ''}</Text>
            </View>
            <View style={styles.etaCol}>
              <Text style={[styles.eta, !card.online && styles.etaOff]}>{card.etaShort}</Text>
              <Text style={styles.meta}>{card.availability}</Text>
            </View>
          </View>
          <Text style={styles.meta}>
            {card.ratingLabel}
            {card.lowRating ? ' · Low rating' : ''}
            {` · ${card.eta}`}
          </Text>
        </Pressable>
        <View style={styles.badges}>
          {card.saved ? <DenseText style={styles.badgePurple}>Preferred</DenseText> : null}
          {card.comfort ? <DenseText style={styles.badgeOrange}>Comfort</DenseText> : null}
          {card.priority ? <DenseText style={styles.badgePurple}>Priority</DenseText> : null}
          <Pressable
            onPress={() => onToggleFavorite(card.id)}
            hitSlop={16}
            accessibilityRole="button"
            accessibilityLabel={card.saved ? `Remove ${card.name} from saved drivers` : `Save ${card.name}`}
            accessibilityHint={card.saved ? 'Removes this driver from your preferred list' : 'Saves this driver as preferred'}
            accessibilityState={{ selected: card.saved }}
          >
            <View style={card.saved ? styles.saveOn : styles.saveOff}>
              <Glyph name="star" size={12} active={card.saved} color={card.saved ? colors.onAccent : colors.orange} />
              <Text style={card.saved ? styles.saveOnText : styles.saveOffText}>{card.saved ? 'Saved' : 'Save'}</Text>
            </View>
          </Pressable>
        </View>
      </View>
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

  return (
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
            onPress={onNotify}
          />
          <PrimaryButton label="Retry" tone="ghost" onPress={onRetry} />
        </View>
      ) : null}
      {(groups.passPreferred || []).length > 0 ? (
        <Text style={styles.meta}>{TIGER_PASS_NAME} offers preferred drivers first, then your other saved drivers.</Text>
      ) : null}
      {favNote ? <Text style={styles.meta}>{favNote}</Text> : null}
      {phase === 'results' && favoriteIds.length === 0 ? (
        <Text style={styles.sub}>{EMPTY_FAVORITES_COPY}</Text>
      ) : null}
      {phase === 'results' ? renderGroups() : null}
      {extra}
    </Animated.ScrollView>
  )
}

function finiteParam(value: string | string[] | undefined) {
  const raw = oneParam(value).trim()
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function PickDriver() {
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
    driver?: string
    tip?: string
  }>()
  const dest = oneParam(params.dest, 'GSP Airport')
  const pickup = oneParam(params.pickup, 'Memorial Stadium')
  const tier = oneParam(params.tier, 'standard')
  const note = oneParam(params.note)
  const passengers = oneParam(params.passengers)
  const driverParam = oneParam(params.driver)
  const tipParam = oneParam(params.tip)
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
    passengers,
  }
  const { user } = useAuth()
  const student = useStudentStatus()
  const demoBusyRoster = useDemoBusyRoster()
  const busy = busyRosterFor({ enabled: demoBusyRoster })
  const [loadedDrivers, setDrivers] = useState<OnlineDriver[]>([])
  const drivers = readablePickerDrivers<OnlineDriver>(loadedDrivers)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'loading' | 'results'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [prepaidTipCents, setPrepaidTipCents] = useState(0)
  const [promptOpen, setPromptOpen] = useState(false)
  const [mapType, setMapType] = useState<MapKind>('standard')
  const [notified, setNotified] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState<string[]>([])
  const [passPreferredIds, setPassPreferredIds] = useState<string[]>([])
  const [favNote, setFavNote] = useState<string | null>(null)
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)

  useEffect(() => {
    let alive = true
    setPhase('loading')
    const wait = new Promise((resolve) => setTimeout(resolve, searchDelayMs()))
    const favorites = user?.id
      ? loadFavoriteDriverIds(supabase, authStorage, user.id)
      : Promise.resolve({ ids: [] as string[], note: null })
    const pass = user?.id
      ? loadTigerPass(supabase).catch((err: unknown) => {
        logCaught('pick-driver-pass', err)
        return null
      })
      : Promise.resolve(null)
    Promise.all([fetchOnlineDrivers(supabase), favorites, wait, pass]).then(async ([result, fav, , loadedPass]) => {
      if (!alive) return
      try {
        const online = sanitizeOnlineDrivers<OnlineDriver>(result?.drivers)
        const extraIds = (fav?.ids || []).filter((id) => !online.some((driver) => driver.id === id))
        const extra = extraIds.length
          ? await fetchDriversByIds(supabase, extraIds)
          : { drivers: [] as OnlineDriver[], error: null as string | null }
        if (!alive) return
        const merged = sortPreferredDrivers(
          filterDriversForFleet(
            sanitizeOnlineDrivers<OnlineDriver>([...online, ...(extra?.drivers || [])]),
            tier,
            user?.id,
          ),
          fav?.ids,
          approachPickup,
        )
        setDrivers(merged)
        setFavoriteIds(fav?.ids || [])
        setPassPreferredIds(loadedPass?.active ? loadedPass.preferredDriverIds || [] : [])
        setFavNote(fav?.note || null)
        setError(extra?.error || result?.error || null)
        setSelected((current) => {
          if (current && merged.some((driver) => driver.id === current)) return current
          if (driverParam && merged.some((driver) => driver.id === driverParam)) return driverParam
          return current && !merged.some((driver) => driver.id === current) ? null : current
        })
        setPhase('results')
        if (merged.some((driver) => driver.online)) {
          await playDriverBrowseCue()
        }
      } catch (err) {
        logCaught('pick-driver-load', err)
        if (!alive) return
        setDrivers([])
        setError('Could not load drivers. Try again.')
        setPhase('results')
      }
    }).catch((err: unknown) => {
      logCaught('pick-driver-load', err)
      if (!alive) return
      setDrivers([])
      setError('Could not load drivers. Try again.')
      setPhase('results')
    })
    return () => {
      alive = false
    }
  }, [attempt, pickup, approachPickup.lat, approachPickup.lng, user?.id, driverParam])

  useEffect(() => {
    const cents = Number(tipParam)
    if (!tipParam || !Number.isFinite(cents) || cents < 0) return
    setPrepaidTipCents(Math.round(cents))
  }, [tipParam])

  const selectedDriver = drivers.find((row: OnlineDriver) => row.id === selected) || null
  const comfortNotice = comfortFleetNotice(tier === 'comfort' || tier === 'comfort' || Boolean(selectedDriver?.comfortClass))

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
    try {
      const saved = await saveFavoriteDriverIds(supabase, authStorage, user.id, next)
      setFavoriteIds(saved.error && !saved.note ? favoriteIds : saved.ids)
      setFavNote(saved.note)
      if (saved.error) setError(saved.error)
      else setError((current) => (
        current === FAVORITE_PERSIST_ERROR || current === FAVORITE_ACCOUNT_SAVE_ERROR ? null : current
      ))
      if (!saved.error || saved.note) {
        try {
          const remote = await setFavoriteDrivers(supabase, saved.ids)
          if (Array.isArray(remote?.favoriteDriverIds)) {
            setFavoriteIds(remote.favoriteDriverIds)
            setPassPreferredIds(remote.active ? remote.preferredDriverIds || [] : [])
            if (remote.demoDriversIgnored) setFavNote(remote.demoNote || 'Preview cars were not saved.')
            if (saved.error === FAVORITE_ACCOUNT_SAVE_ERROR) {
              setError((current) => (current === FAVORITE_ACCOUNT_SAVE_ERROR ? null : current))
            }
          }
        } catch (err) {
          logCaught('pick-driver-favorite', err)
        }
      }
    } catch (err) {
      setFavoriteIds(favoriteIds)
      setError(err instanceof Error ? err.message : FAVORITE_PERSIST_ERROR)
    }
    await tapHaptic()
  }

  const pins = drivers
    .filter((driver: OnlineDriver) => Number.isFinite(Number(driver?.lat)) && Number.isFinite(Number(driver?.lng)))
    .map((driver: OnlineDriver) => ({
      id: driver.id,
      latitude: Number(driver.lat),
      longitude: Number(driver.lng),
      title: textField(driver.name, 'Driver'),
      color: colors.orange,
    }))

  const anyOnline = drivers.some((driver: OnlineDriver) => driver.online)

  function openAddCard() {
    router.push({
      pathname: '/billing',
      params: {
        returnTo: 'pick-driver',
        add: '1',
        ...resumeParams,
        tip: String(prepaidTipCents),
        driver: selected || driverParam,
      },
    })
  }

  async function paymentForRequest() {
    const applePay = await applePaySetUp()
    if (!supabase || !user) return { ready: false, source: null as string | null }
    const { data, error: lookupError } = await supabase
      .from('profiles')
      .select('stripe_default_pm_id, stripe_card_brand')
      .eq('id', user.id)
      .maybeSingle()
    if (lookupError) return { ready: true, source: applePay ? 'apple_pay' : null }
    const ready = riderPaymentMethodReady(data, { applePay })
    return { ready: ready.ok, source: ready.source }
  }

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
      setError('Extra Comfort only.')
      return
    }
    if (!user) {
      setAuthNext({ pathname: '/pick-driver', params: resumeParams })
      setPromptOpen(true)
      return
    }
    setRequesting(true)
    setError(null)
    try {
      const gate = await paymentForRequest()
      if (!gate.ready) {
        openAddCard()
        return
      }
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
        prepaidTipCents,
        ...(gate.source === 'apple_pay' ? { applePay: true } : {}),
      })
      await playDriverFoundCue()
      router.replace({
        pathname: '/requested',
        params: { dest, trip: trip.id, driver: chosen?.name || 'Next driver' },
      })
    } catch (err) {
      if (paymentMethodRequiredError(err)) {
        openAddCard()
        return
      }
      const redirect = scheduleRedirectForRequestError(
        err && typeof err === 'object' ? err as { code?: string } : undefined,
        dest,
      )
      if (redirect) {
        router.push(redirect.airport
          ? { pathname: '/schedule', params: { airport: redirect.airport } }
          : '/schedule')
        return
      }
      setError(err instanceof Error ? err.message : 'Could not request that driver')
    } finally {
      setRequesting(false)
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
          <Glyph name="back" size={20} color={colors.title} accessibilityLabel="Back" />
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
      <FlowErrorBoundary title="Clemson Rides" fill>
        <DriverRoster
          phase={phase}
          drivers={drivers}
          passPreferredIds={passPreferredIds}
          error={error}
          notified={notified}
          favNote={favNote}
          favoriteIds={favoriteIds}
          selected={selected}
          approachPickup={approachPickup}
          extra={(
            <>
              {/* Busy roster: display only; kept outside real driver sections. */}
              {busy.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>BUSY NOW</Text>
                  {busy.map((driver) => {
                    const card = rosterCard(driver)
                    if (!card) return null
                    let portrait = { initials: '?', color: colors.purple }
                    try {
                      const resolved = resolveDriverPortrait(driver)
                      portrait = { initials: resolved?.initials || '?', color: resolved?.color || colors.purple }
                    } catch (err) {
                      logCaught('pick-driver-roster', err)
                      portrait = { initials: '?', color: colors.purple }
                    }
                    return (
                      <View key={card.id} aria-disabled={true} accessibilityState={{ disabled: true }} style={[styles.card, { opacity: 0.55 }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: portrait.color || colors.purple }}>
                            <Text style={{ color: colors.onAccent, fontWeight: '800' }}>{portrait.initials}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.name}>{card.name}</Text>
                            <View style={styles.ratingRow}>
                              <Glyph name="star" size={12} active color={colors.orange} />
                              <Text style={styles.meta}>{card.rating} · {card.tripCountLabel} trips</Text>
                            </View>
                            <Text style={styles.sub}>{card.vehicleLabel}</Text>
                          </View>
                          <DenseText style={{ fontSize: 12, fontWeight: '700', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5, overflow: 'hidden', backgroundColor: card.status === 'on_trip' ? colors.orangeSoft : colors.track, color: card.status === 'on_trip' ? colors.orange : colors.inkSecondary }}>{card.statusLabel}</DenseText>
                        </View>
                      </View>
                    )
                  })}
                </View>
              ) : null}
              {/* End busy roster. */}
            </>
          )}
          onSelect={(id) => { void tapHaptic(); setSelected(id) }}
          onToggleFavorite={(id) => { void toggleFavorite(id) }}
          onNotify={() => {
            void (async () => {
              await authStorage.setItem(NOTIFY_KEY, new Date().toISOString()).catch((err: unknown) => {
                logCaught('pick-driver-notify', err)
              })
              setNotified(true)
              await tapHaptic()
            })()
          }}
          onRetry={() => setAttempt((value: number) => value + 1)}
        />
      </FlowErrorBoundary>
      <View style={[styles.footer, lift(colors, 'bar'), { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {comfortNotice ? <Text style={styles.comfortNotice}>{comfortNotice}</Text> : null}
        {student.verified && tier === 'standard' ? (
          <Text style={styles.student}>{STUDENT_DISCOUNT_LABEL} is on this request.</Text>
        ) : null}
        {student.verified && tier !== 'standard' ? (
          <Text style={styles.student}>Student pricing is 10% off Standard. This tier stays full price.</Text>
        ) : null}
        <TipBoostPicker cents={prepaidTipCents} onChange={setPrepaidTipCents} />
        {error && drivers.some((driver: OnlineDriver) => driver.online) ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>
        ) : null}
        <PrimaryButton
          label={requesting ? 'Requesting…' : selectedDriver ? `Request ${selectedDriver.name}` : (anyOnline ? 'Request next driver' : 'Select a driver')}
          onPress={onRequest}
          disabled={requesting || (selectedDriver ? !selectedDriver.online : !anyOnline)}
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

export default function PickDriverScreen() {
  return (
    <FlowErrorBoundary title="Pick a driver" fill>
      <PickDriver />
    </FlowErrorBoundary>
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
    kindText: { color: colors.link, fontSize: 12, fontWeight: '800' as const },
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
    badgeOrange: { color: colors.orange, backgroundColor: colors.orangeSoft, overflow: 'hidden' as const, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12, fontWeight: '800' as const },
    badgePurple: { color: colors.link, backgroundColor: colors.purpleSoft, overflow: 'hidden' as const, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12, fontWeight: '800' as const },
    ratingRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
    saveOn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, backgroundColor: colors.purple, overflow: 'hidden' as const, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    saveOff: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
    saveOnText: { color: colors.onAccent, fontSize: 12, fontWeight: '800' as const },
    saveOffText: { color: colors.orange, fontSize: 12, fontWeight: '800' as const },
    footer: { paddingHorizontal: 20, paddingTop: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
    student: { color: colors.orange, fontWeight: '800' as const, fontSize: 13 },
    comfortNotice: { color: colors.link, fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  }
}
