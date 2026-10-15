import { GlassBadge, Glyph } from 'rides-native/icons'
import { useGlobalSearchParams, useRouter } from 'expo-router'
import * as Location from 'expo-location'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { GestureDetector } from 'react-native-gesture-handler'
import Reanimated from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Pill, SheetHandle } from '@/components/Button'
import { RetryAction } from '@/components/RetryAction'
import { pressStyle, useEnterMotion } from '@/components/enter'
import { CampusMap } from '@/components/CampusMap'
import type { CampusMapHandle, LatLng, MapKind } from '@/components/mapTypes'
import { mapKindLabel } from '@/components/mapTypes'
import { TabSwipeRegion, useTabSwipeMeasure, useTabSwipeRemeasure } from '@/components/MainTabPager'
import { Skeleton } from '@/components/Skeleton'
import { loadBusySpots, type BusySpot } from '@/lib/busySpots'
import { logCaught, toastCaught } from '@/lib/caught'
import { useAuth } from '@/lib/auth'
import { setAuthNext } from '@/lib/authNext'
import { listScheduledTrips, type ScheduledRow } from '@/lib/scheduleApi'
import { playMatchChime, tapHaptic } from '@/lib/feedback'
import { oneParam } from '@/lib/oneParam'
import { displayFirstName } from 'rides-native/authErrors'
import { nativeGlassAvailable } from 'rides-native/glass'
import { campusOverlays } from 'rides-native/riderShell.js'
import { loadGameDay } from 'rides-native/driverDesk'
import { gameDayNotice, type GameDayNotice } from 'rides-native/gameDayNotice.js'
import { GameDayBanner } from 'rides-native/GameDayBoard.jsx'
import { useGameDayExperience } from 'rides-native/useGameDayExperience.js'
import { studentSurfaceCopy } from 'rides-native/riderMoney.js'
import { dueScheduleReminders } from '../../../../src/lib/scheduledRideModel.js'
import { supabase } from '@/lib/supabase'
import { useStudentStatus } from '@/lib/useStudentStatus'
import { liveRideDistanceLine, riderLiveView } from 'rides-native/liveTrip'
import { useHomeLiveTrip } from '@/lib/useHomeLiveTrip'
import { HEAT_WINDOWS, SHORTCUTS } from 'rides-native/places.js'
import { hotCatalogPlaces, lookupCatalogPlace, searchCatalogPlaces } from 'rides-native/shared/carpool.js'
import { lift } from '@/lib/elevation'
import { HOME_SHEET_BOTTOM_PADDING, homeTabClearance } from '@/lib/homeSheetSnap'
import { useHomeSheetSnap } from '@/lib/useHomeSheetSnap'
import { useReconnectRetry } from '@/lib/useReconnectRetry'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

const MAP_KINDS: MapKind[] = ['standard', 'satellite', 'hybrid']

/** Heat still follows showBusy. This control stays in the file and off the home screen. */
const SHOW_BUSY_AREAS_TOGGLE = false

const PLACES = [
  ...SHORTCUTS.map((shortcut) => ({ ...shortcut, glyph: 'campus' })),
  { id: 'gsp', label: 'GSP Airport', sub: 'GSP', glyph: 'airport' },
  { id: 'clt', label: 'CLT Airport', sub: 'CLT', glyph: 'airport' },
]

const QUICK_ACTIONS = [
  { id: 'schedule', label: 'Schedule a ride', detail: 'Choose a time', icon: 'schedule' as const, href: '/schedule' as const },
  { id: 'carpool', label: 'Carpool', detail: 'Split the surge', icon: 'carpool' as const, href: '/friends' as const },
  { id: 'airport', label: 'Airport', detail: 'GSP and CLT', icon: 'airport' as const, href: '/schedule' as const },
  { id: 'tiger-pass', label: 'Tiger Pass', detail: 'Rider membership', icon: 'pass' as const, href: '/tiger-pass' as const },
  { id: 'safety', label: 'Safety', detail: 'Audio, video, tracking, SOS', icon: 'shield' as const, href: '/safety' as const },
  { id: 'history', label: 'Your rides', detail: 'Trip history', icon: 'history' as const, href: '/history' as const },
]

export function RiderHome() {
  const router = useRouter()
  const routeParams = useGlobalSearchParams<{ tier?: string | string[] }>()
  const mapSwipe = useTabSwipeMeasure('map')
  const sheetSwipe = useTabSwipeMeasure('sheet')
  const remeasureTabs = useTabSwipeRemeasure()
  const presetTier = oneParam(routeParams.tier)
  const tierParams = presetTier === 'standard' || presetTier === 'wait' || presetTier === 'comfort' || presetTier === 'carpool'
    ? { tier: presetTier }
    : {}
  const insets = useSafeAreaInsets()
  const inputRef = useRef<TextInput>(null)
  const scrollRef = useRef<ScrollView>(null)
  const { user, configured } = useAuth()
  const liveTrip = useHomeLiveTrip(user?.id)
  const [liveCardH, setLiveCardH] = useState(120)
  const nativeTabs = Platform.OS === 'ios' && nativeGlassAvailable()
  const sheet = useHomeSheetSnap(() => {
    inputRef.current?.focus()
  }, liveTrip ? liveCardH + 12 : 0)
  const { colors, scheme } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const mapRef = useRef<CampusMapHandle>(null)
  const [query, setQuery] = useState('')
  const [destError, setDestError] = useState<string | null>(null)
  const suggestions = useMemo(() => {
    const found = searchCatalogPlaces(query)
    if (query.trim().length >= 2) return found.slice(0, 6)
    return hotCatalogPlaces()
  }, [query])
  const [showBusy, setShowBusy] = useState(true)
  const [heatWindow, setHeatWindow] = useState('now')
  const [spots, setSpots] = useState<BusySpot[]>([])
  const [caption, setCaption] = useState('Popular campus spots from ride requests — dorms, downtown, stadium.')
  const [blended, setBlended] = useState(false)
  const [spotsLoading, setSpotsLoading] = useState(true)
  const [homeRetry, setHomeRetry] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [mapType, setMapType] = useState<MapKind>('standard')
  const [userCoord, setUserCoord] = useState<LatLng | null>(null)
  const [locateNote, setLocateNote] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const overlays = useMemo(() => campusOverlays(), [])
  const [surge, setSurge] = useState(overlays.surge)
  const [gameNotice, setGameNotice] = useState<GameDayNotice | null>(null)
  const [scheduledRows, setScheduledRows] = useState<ScheduledRow[]>([])
  const [clock, setClock] = useState(() => new Date())
  const student = useStudentStatus()
  const studentOffer = studentSurfaceCopy(student, 'home')
  const gameDay = Boolean(gameNotice?.live)
  const gameDayExperience = useGameDayExperience(supabase)
  const reminders = useMemo(() => dueScheduleReminders(scheduledRows, clock), [scheduledRows, clock])
  const liveDistance = liveTrip
    ? liveRideDistanceLine(
      liveTrip.status,
      liveTrip.driverLat != null && liveTrip.driverLng != null
        ? { lat: liveTrip.driverLat, lng: liveTrip.driverLng }
        : null,
      liveTrip,
    )
    : null
  const chromeMotion = useEnterMotion(8)
  const sheetMotion = useEnterMotion(16)

  useEffect(() => {
    if (sheet.detent !== 'collapsed') return
    scrollRef.current?.scrollTo({ y: 0, animated: false })
  }, [sheet.detent])

  const name = user
    ? displayFirstName(user.user_metadata?.full_name || user.email?.split('@')[0], 'Tiger')
    : 'Tiger'
  const initial = name.slice(0, 1).toUpperCase()

  async function reloadSpots(windowId: string) {
    const result = await loadBusySpots(windowId)
    setSpots(result.spots)
    setCaption(result.caption)
    setBlended(result.blended)
    setSpotsLoading(false)
  }

  async function loadGameNotice() {
    if (!supabase) {
      setGameNotice(gameDayNotice(null))
      return true
    }
    try {
      const row = await loadGameDay(supabase)
      setGameNotice(gameDayNotice(row))
      return true
    } catch (err) {
      logCaught('home-game-day', err)
      setGameNotice(gameDayNotice(null))
      return false
    }
  }

  async function loadScheduledReminders() {
    if (!user?.id) {
      setScheduledRows([])
      return true
    }
    try {
      setScheduledRows(await listScheduledTrips(user.id))
      setClock(new Date())
      return true
    } catch (err) {
      toastCaught('home-scheduled', err, 'Could not load scheduled rides')
      setScheduledRows([])
      return false
    }
  }

  async function refreshBooking() {
    const spotsOk = await reloadSpots(heatWindow).then(() => true).catch((err: unknown) => {
      logCaught('home-busy-spots', err)
      setSpotsLoading(false)
      return false
    })
    const gameOk = await loadGameNotice()
    const ridesOk = await loadScheduledReminders()
    setHomeRetry(spotsOk && gameOk && ridesOk ? null : 'Could not refresh rides. Retry when you reconnect.')
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!supabase) {
        if (alive) setGameNotice(gameDayNotice(null))
        return
      }
      try {
        const row = await loadGameDay(supabase)
        if (alive) setGameNotice(gameDayNotice(row))
      } catch (err) {
        logCaught('home-game-day', err)
        if (alive) {
          setGameNotice(gameDayNotice(null))
          setHomeRetry('Could not refresh rides. Retry when you reconnect.')
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let alive = true
    if (!user?.id) {
      setScheduledRows([])
      return undefined
    }
    listScheduledTrips(user.id).then((rows) => {
      if (!alive) return
      setScheduledRows(rows)
      setClock(new Date())
    }).catch((err: unknown) => {
      toastCaught('home-scheduled', err, 'Could not load scheduled rides')
      if (alive) {
        setScheduledRows([])
        setHomeRetry('Could not refresh rides. Retry when you reconnect.')
      }
    })
    return () => {
      alive = false
    }
  }, [user?.id])

  useEffect(() => {
    let alive = true
    setSpotsLoading(true)
    loadBusySpots(heatWindow).then((result) => {
      if (!alive) return
      setSpots(result.spots)
      setCaption(result.caption)
      setBlended(result.blended)
      setSpotsLoading(false)
    }).catch((err: unknown) => {
      logCaught('home-busy-spots', err)
      if (alive) {
        setSpotsLoading(false)
        setHomeRetry('Could not refresh rides. Retry when you reconnect.')
      }
    })
    return () => {
      alive = false
    }
  }, [heatWindow])

  useReconnectRetry('booking-home', () => refreshBooking(), homeRetry != null)

  const goSearch = (dest?: string) => {
    if (dest) {
      const known = lookupCatalogPlace(dest)
      void tapHaptic()
      router.push({ pathname: '/confirm', params: { dest: known?.label || dest, ...tierParams } })
      return
    }
    const typed = lookupCatalogPlace(query)
    if (!typed) {
      setDestError('Pick a campus or airport stop. Try Grand Marc, the stadium, or GSP.')
      return
    }
    setDestError(null)
    void tapHaptic()
    router.push({ pathname: '/confirm', params: { dest: typed.label, ...tierParams } })
  }

  async function onLocate() {
    void tapHaptic()
    setLocating(true)
    setLocateNote(null)
    try {
      const permission = await Location.requestForegroundPermissionsAsync()
      if (permission.status !== 'granted') {
        setLocateNote('Location permission is off.')
        return
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const coord = { latitude: position.coords.latitude, longitude: position.coords.longitude }
      setUserCoord(coord)
      mapRef.current?.animateTo(coord)
    } catch (err) {
      setLocateNote(err instanceof Error ? err.message : 'Could not read your location.')
    } finally {
      setLocating(false)
    }
  }

  return (
    <View style={[styles.screen, nativeTabs ? { paddingBottom: homeTabClearance(insets.bottom) } : null]}>
      <View
        ref={(node) => {
          mapSwipe.ref.current = node
        }}
        onLayout={mapSwipe.onLayout}
        collapsable={false}
        style={styles.mapSlot}
      >
        <CampusMap
          ref={mapRef}
          spots={spots}
          showHeat={showBusy}
          heatWindow={heatWindow}
          mapType={mapType}
          gameDay={gameDay}
          gameDayLabel={gameNotice?.live ? gameNotice.headline : null}
          surge={surge}
          userCoordinate={userCoord}
          showSimulatedFleet
        />
        <Animated.View pointerEvents="box-none" style={[styles.mapChrome, { paddingTop: insets.top + 10 }, chromeMotion]}>
          <View style={styles.topBar}>
            <View style={[styles.brand, lift(colors, 'float')]}>
              <View style={styles.brandMark}>
                <Text style={styles.brandMarkText}>CR</Text>
              </View>
              <View style={styles.brandCopy}>
                <Text style={styles.brandKicker}>RIDE • GAME • REPEAT</Text>
                <Text style={styles.brandTitle}>Clemson <Text style={styles.brandSoft}>Rides</Text></Text>
                <Text style={styles.brandPillText}>TIGERS GET YOU THERE</Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Account"
              accessibilityHint={user ? 'Opens your account' : 'Sign in to open your account'}
              onPress={() => {
                void tapHaptic()
                // No loaded account: go to login instead of a gated screen.
                if (!user) {
                  setAuthNext('/account')
                  router.push('/sign-in')
                  return
                }
                router.push('/account')
              }}
              style={({ pressed }) => [styles.avatar, lift(colors, 'rest'), pressStyle(pressed)]}
            >
              <Text style={styles.avatarText}>{initial}</Text>
            </Pressable>
          </View>
          <View style={styles.mapControls}>
            <View style={[styles.kindRow, lift(colors, 'rest')]}>
              {MAP_KINDS.map((kind) => {
                const on = mapType === kind
                return (
                  <Pressable
                    key={kind}
                    onPress={() => setMapType(kind)}
                    style={[styles.kindChip, on && styles.kindOn]}
                    accessibilityRole="button"
                    accessibilityLabel={`${mapKindLabel(kind)} map`}
                    accessibilityHint="Changes the campus map style"
                    accessibilityState={{ selected: on }}
                    hitSlop={10}
                  >
                    <Text style={[styles.kindText, on && styles.kindTextOn]}>{mapKindLabel(kind)}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Pressable
              onPress={onLocate}
              style={({ pressed }) => [styles.locate, lift(colors, 'rest'), pressStyle(pressed)]}
              accessibilityRole="button"
              accessibilityLabel="Center on me"
              accessibilityHint="Moves the map to your location"
              accessibilityState={{ busy: locating }}
            >
              <Text style={styles.locateText}>{locating ? '…' : '◎'}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>

      <Animated.View
        ref={(node) => {
          sheetSwipe.ref.current = node
        }}
        onLayout={sheetSwipe.onLayout}
        style={[styles.sheetWrap, lift(colors, 'float'), sheetMotion]}
      >
      <Reanimated.View style={[styles.sheet, sheet.sheetStyle]}>
        <GestureDetector gesture={sheet.handlePan}>
          <View
            onLayout={sheet.onHandleLayout}
            style={styles.handleBlock}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={sheet.detent === 'collapsed' ? 'Home sheet collapsed' : 'Drag down to expand the map'}
            accessibilityHint={sheet.detent === 'collapsed' ? 'Drag up to show more. Tap the search field to type a destination.' : 'Drag up or down to resize the map'}
            accessibilityActions={[
              { name: 'increment', label: 'Expand sheet' },
              { name: 'decrement', label: 'Collapse sheet' },
            ]}
            onAccessibilityAction={(event) => {
              const action = event.nativeEvent.actionName
              if (action === 'increment') sheet.nudge(1)
              else if (action === 'decrement') sheet.nudge(-1)
            }}
          >
            <SheetHandle />
          </View>
        </GestureDetector>
        <Reanimated.View
          pointerEvents="none"
          style={sheet.hintStyle}
          accessibilityElementsHidden={sheet.detent === 'collapsed'}
        >
          <Text style={styles.dragHint}>Drag down to expand the map</Text>
        </Reanimated.View>
        <View onLayout={sheet.onSearchLayout} style={styles.searchBlock}>
          <Text style={styles.prompt} accessibilityElementsHidden={sheet.detent === 'collapsed'}>Where are you headed, Tiger?</Text>
          <View
            style={[styles.search, lift(colors, 'rest')]}
            accessibilityElementsHidden={sheet.detent === 'collapsed'}
            importantForAccessibility={sheet.detent === 'collapsed' ? 'no-hide-descendants' : 'auto'}
          >
            <View style={styles.searchMark} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Campus, GSP, CLT…"
              placeholderTextColor={colors.placeholder}
              style={styles.searchInput}
              autoCorrect={false}
              editable={sheet.detent !== 'collapsed'}
              pointerEvents={sheet.detent === 'collapsed' ? 'none' : 'auto'}
              accessibilityLabel="Destination"
              accessibilityHint="Search a campus stop or airport"
            />
          </View>
          {sheet.detent === 'collapsed' ? (
            <GestureDetector gesture={sheet.searchGesture}>
              <View
                collapsable={false}
                style={styles.searchCover}
                accessible
                accessibilityRole="button"
                accessibilityLabel="Where are you headed, Tiger?"
                accessibilityHint="Expands the sheet and focuses destination search"
                onAccessibilityTap={sheet.expandFromSearch}
              />
            </GestureDetector>
          ) : null}
        </View>
        {liveTrip ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Live ride. ${riderLiveView(liveTrip.status).title}. ${liveDistance || `Open tracking for ${liveTrip.dropoff_label || 'this trip'}.`}`}
            accessibilityHint="Opens live trip tracking"
            onLayout={(event) => {
              const next = Math.ceil(event.nativeEvent.layout.height)
              setLiveCardH((current) => (next > 0 && next !== current ? next : current))
            }}
            onPress={() => router.push({ pathname: '/requested', params: { trip: liveTrip.id, dest: liveTrip.dropoff_label || '' } })}
            style={({ pressed }) => [styles.liveCard, lift(colors, 'rest'), pressStyle(pressed)]}
          >
            <Text style={styles.liveKicker}>LIVE RIDE</Text>
            <Text style={styles.liveTitle}>{riderLiveView(liveTrip.status).title}</Text>
            <Text style={styles.liveBody}>{liveDistance || `Open tracking for ${liveTrip.dropoff_label || 'this trip'}.`}</Text>
          </Pressable>
        ) : null}
        <ScrollView
          ref={scrollRef}
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onScroll={remeasureTabs}
          scrollEventThrottle={32}
          scrollEnabled={sheet.scrollEnabled}
          pointerEvents={sheet.scrollEnabled ? 'auto' : 'none'}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.orange}
              onRefresh={() => {
                setRefreshing(true)
                refreshBooking().finally(() => setRefreshing(false))
              }}
            />
          )}
        >
          {spotsLoading ? (
            <View style={styles.skeletonBlock}>
              <Skeleton height={18} width="36%" />
              <Skeleton height={28} width="78%" />
              <Skeleton height={56} />
            </View>
          ) : (
            <Text style={styles.welcome}>Welcome, {name}</Text>
          )}
          {homeRetry ? (
            <View accessibilityLiveRegion="polite">
              <Text style={styles.locateNote}>{homeRetry}</Text>
              <RetryAction
                hint="Loads campus spots, game day, and scheduled rides again"
                onPress={() => { void refreshBooking() }}
              />
            </View>
          ) : null}
          {gameDayExperience.ready && gameDayExperience.model.phase !== 'off' ? (
            <GameDayBanner model={gameDayExperience.model} onPress={() => router.push('/game-day')} />
          ) : !gameDayExperience.ready && gameNotice?.live ? (
            <View
              accessibilityRole="text"
              accessibilityLabel={`${gameNotice.headline}. ${gameNotice.detail || ''}. ${gameNotice.body}`}
              style={[styles.liveCard, styles.gameCard, lift(colors, 'rest')]}
            >
              <Text style={styles.liveKicker}>GAME DAY</Text>
              <Text style={styles.liveTitle}>{gameNotice.headline}</Text>
              {gameNotice.detail ? <Text style={styles.gameDetail}>{gameNotice.detail}</Text> : null}
              <Text style={styles.liveBody}>{gameNotice.body}</Text>
            </View>
          ) : null}
          {reminders.map((item: { tripId?: string; label?: string; body?: string }) => (
            <Pressable
              key={item.tripId}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}. ${item.body}`}
              accessibilityHint="Opens your scheduled rides"
              onPress={() => {
                void tapHaptic()
                router.push('/schedule')
              }}
              style={({ pressed }) => [styles.liveCard, lift(colors, 'rest'), pressStyle(pressed)]}
            >
              <Text style={styles.liveKicker}>PICKUP REMINDER</Text>
              <Text style={styles.liveTitle}>{item.label}</Text>
              <Text style={styles.liveBody}>{item.body}</Text>
            </Pressable>
          ))}
          <TabSwipeRegion>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {suggestions.map((stop: { id: string; label: string }) => (
              <Pressable
                key={stop.id}
                accessibilityRole="button"
                accessibilityLabel={stop.label}
                accessibilityHint="Requests a ride to this place"
                accessibilityState={{ selected: query === stop.label }}
                hitSlop={8}
                onPress={() => {
                  setQuery(stop.label)
                  setDestError(null)
                  goSearch(stop.label)
                }}
                style={({ pressed }) => [styles.destChip, query === stop.label && styles.destChipOn, pressStyle(pressed)]}
              >
                <Text style={[styles.destChipText, query === stop.label && styles.destChipTextOn]}>{stop.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          </TabSwipeRegion>
          {query.trim().length >= 2 && suggestions.length === 0 ? (
            <Text style={styles.locateNote}>No campus or airport match. Try Grand Marc, the stadium, or GSP.</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search destination"
            accessibilityHint="Continues to confirm pickup"
            hitSlop={8}
            onPress={() => goSearch()}
            style={({ pressed }) => [styles.searchLink, pressStyle(pressed)]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Glyph name="search" size={18} color={colors.link} />
              <Text style={styles.searchLinkText}>Search destination</Text>
              <Glyph name="forward" size={16} color={colors.link} />
            </View>
          </Pressable>
          {destError ? <Text style={styles.locateNote}>{destError}</Text> : null}

          <Text style={styles.sectionLabel}>Get around</Text>
          <View style={styles.actions}>
            {[0, 1].map((column) => (
              <View key={column} style={styles.actionCol}>
                {QUICK_ACTIONS.filter((_, index) => index % 2 === column).map((action) => (
                  <Pressable
                    key={action.id}
                    accessibilityRole="button"
                    accessibilityLabel={action.detail ? `${action.label}. ${action.detail}` : action.label}
                    accessibilityHint={`Opens ${action.label}`}
                    onPress={() => {
                      void tapHaptic()
                      router.push(action.href)
                    }}
                    style={({ pressed }) => [styles.action, lift(colors, 'rest'), pressStyle(pressed)]}
                  >
                    <GlassBadge name={action.icon} size={40} tone={action.id === 'safety' ? 'purple' : 'orange'} scheme={scheme} style={styles.actionIcon} />
                    <Text style={styles.actionLabel}>{action.label}</Text>
                    <Text style={styles.actionDetail}>{action.detail}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Places</Text>
          <TabSwipeRegion>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shortcuts}>
            {PLACES.map((shortcut) => (
              <Pressable
                key={shortcut.id}
                onPress={() => goSearch(shortcut.sub)}
                style={({ pressed }) => [styles.shortcut, lift(colors, 'rest'), pressStyle(pressed)]}
                accessibilityRole="button"
                accessibilityLabel={`${shortcut.label}. ${shortcut.sub}`}
                accessibilityHint="Requests a ride to this place"
              >
                <Glyph name={shortcut.glyph} size={22} color={colors.purple} style={styles.shortcutIcon} />
                <Text style={styles.shortcutLabel}>{shortcut.label}</Text>
                <Text style={styles.shortcutSub}>{shortcut.sub}</Text>
              </Pressable>
            ))}
          </ScrollView>
          </TabSwipeRegion>

          <View style={[styles.campusCard, lift(colors, 'rest')]}>
            <View style={styles.mapHead}>
              <View style={styles.campusCopy}>
                <Text style={styles.mapTitle}>Campus map</Text>
                <Text style={styles.busyDays}>Busy days</Text>
              </View>
              {SHOW_BUSY_AREAS_TOGGLE ? (
                <Pressable
                  onPress={() => {
                    void tapHaptic()
                    setShowBusy((value: boolean) => !value)
                  }}
                  style={[styles.busy, showBusy && styles.busyOn]}
                  accessibilityRole="button"
                  accessibilityLabel={showBusy ? 'Busy areas on' : 'Busy areas off'}
                  accessibilityHint="Shows or hides busy areas on the campus map"
                  accessibilityState={{ selected: showBusy }}
                  hitSlop={8}
                >
                  <Text style={[styles.busyText, showBusy && styles.busyTextOn]}>
                    {showBusy ? 'Busy Areas · On' : 'Busy Areas · Off'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {spotsLoading ? (
              <Skeleton height={32} width="70%" />
            ) : (
              <>
                <TabSwipeRegion>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller} contentContainerStyle={[styles.row, styles.chipRow]}>
                  {showBusy
                    ? HEAT_WINDOWS.map((window) => (
                        <Pill
                          key={window.id}
                          label={window.label}
                          active={heatWindow === window.id}
                          onPress={() => setHeatWindow(window.id)}
                        />
                      ))
                    : null}
                  <Pill label={gameNotice == null ? 'Game day…' : gameNotice.headline} active={gameDay} />
                  <Pill label={surge ? 'Surge · On' : 'Surge'} active={surge} onPress={() => setSurge((value: boolean) => !value)} />
                </ScrollView>
                </TabSwipeRegion>
                <Text style={styles.caption}>
                  {showBusy ? caption : 'Busy areas are hidden.'}
                  {showBusy && blended ? <Text style={styles.live}>  Live + typical</Text> : null}
                  {gameNotice ? `  ${gameNotice.live ? gameNotice.detail : gameNotice.body}` : '  Checking game day…'}
                  {surge ? `  ${overlays.surgeLabel || 'Surge overlay'}` : ''}
                </Text>
              </>
            )}
            {locateNote ? <Text style={styles.locateNote}>{locateNote}</Text> : null}
          </View>

          {!configured ? (
            <Text style={styles.keys}>
              This build needs EXPO_PUBLIC_SUPABASE_ANON_KEY as an EAS environment variable before sign-in works.
            </Text>
          ) : null}

          <Pressable
            onPress={() => {
              void tapHaptic()
              router.push(user ? '/student' : '/sign-in')
            }}
            style={({ pressed }) => [styles.studentCard, studentOffer.granted && styles.studentOn, lift(colors, 'rest'), pressStyle(pressed)]}
            accessibilityRole="button"
            accessibilityLabel={studentOffer.detail ? `${studentOffer.title}. ${studentOffer.detail}` : studentOffer.title}
            accessibilityHint={user ? 'Opens student pricing' : 'Sign in to check student pricing'}
          >
            <View style={styles.offerIcon}>
              <Glyph name="learning" size={24} color={colors.purple} />
            </View>
            <View style={styles.gamedayCopy}>
              <Text style={styles.gamedayTitle}>{studentOffer.title}</Text>
              <Text style={styles.gamedayBody}>{studentOffer.detail}</Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => {
              void playMatchChime()
              router.push('/friends')
            }}
            style={({ pressed }) => [styles.gameday, lift(colors, 'rest'), pressStyle(pressed)]}
            accessibilityRole="button"
            accessibilityLabel="Game day carpool. About 10 to 15 dollars each instead of 30 to 40."
            accessibilityHint="Opens carpools"
          >
            <View style={styles.offerIcon}>
              <Glyph name="dropoff" size={24} color={colors.orange} />
            </View>
            <View style={styles.gamedayCopy}>
              <Text style={styles.gamedayTitle}>Game day carpool</Text>
              <Text style={styles.gamedayBody}>About $10–$15 each instead of $30–$40.</Text>
            </View>
            <View style={styles.gamedayBtn}>
              <Text style={styles.gamedayBtnText}>Find a carpool</Text>
            </View>
          </Pressable>
        </ScrollView>
      </Reanimated.View>
      </Animated.View>
    </View>
  )
}

export default function RidesRoute() {
  if (Platform.OS === 'ios' && nativeGlassAvailable()) return <RiderHome />
  return null
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    mapSlot: { flex: 1, minHeight: 0, backgroundColor: colors.mapFallback, overflow: 'hidden' as const },
    mapChrome: {
      position: 'absolute' as const,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      justifyContent: 'space-between' as const,
      paddingBottom: 28,
    },
    topBar: {
      paddingHorizontal: 16,
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'flex-start' as const,
      gap: 12,
    },
    brand: {
      flex: 1,
      maxWidth: 280,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 10,
      borderRadius: 18,
      backgroundColor: colors.card,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    brandMark: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.orange,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    brandMarkText: { color: colors.onAccent, fontSize: 12, fontWeight: '800' as const, letterSpacing: 0.4 },
    brandCopy: { flex: 1 },
    brandKicker: { color: colors.orange, fontSize: 9, fontWeight: '700' as const, letterSpacing: 1.1 },
    brandTitle: { color: colors.title, fontSize: 16, fontWeight: '800' as const, letterSpacing: -0.3, marginTop: 1 },
    brandSoft: { fontWeight: '600' as const, color: colors.ink },
    brandPillText: { color: colors.inkSecondary, fontSize: 9, fontWeight: '700' as const, letterSpacing: 0.6, marginTop: 2 },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.purple,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderWidth: 2,
      borderColor: colors.onAccent,
    },
    avatarText: { color: colors.onAccent, fontWeight: '800' as const, fontSize: 17 },
    mapControls: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'flex-end' as const,
      paddingHorizontal: 16,
    },
    kindRow: {
      flexDirection: 'row' as const,
      gap: 2,
      backgroundColor: colors.card,
      borderRadius: 999,
      padding: 3,
    },
    kindChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
    kindOn: { backgroundColor: colors.purple },
    kindText: { color: colors.link, fontSize: 11, fontWeight: '700' as const },
    kindTextOn: { color: colors.onAccent },
    locate: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.card,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    locateText: { color: colors.orange, fontSize: 20, fontWeight: '700' as const },
    campusCard: {
      marginTop: 18,
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 8,
    },
    mapHead: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, gap: 10 },
    campusCopy: { flex: 1 },
    mapTitle: { fontWeight: '700' as const, fontSize: 15, letterSpacing: -0.2, color: colors.ink },
    busyDays: { color: colors.inkSecondary, fontSize: 12, fontWeight: '600' as const, marginTop: 2 },
    busy: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.purpleSoft },
    busyOn: { backgroundColor: colors.orange },
    busyText: { color: colors.link, fontSize: 12, fontWeight: '700' as const },
    busyTextOn: { color: colors.onAccent },
    row: { gap: 8, paddingVertical: 2 },
    chipScroller: { flexGrow: 0, alignSelf: 'stretch' as const },
    chipRow: { alignItems: 'flex-start' as const, flexGrow: 0 },
    caption: { color: colors.inkSecondary, fontSize: 12, lineHeight: 18 },
    live: { color: colors.link, fontWeight: '700' as const },
    destChip: {
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.chip,
    },
    destChipOn: { backgroundColor: colors.purple, borderColor: colors.purple },
    destChipText: { color: colors.link, fontWeight: '700' as const, fontSize: 13 },
    destChipTextOn: { color: colors.onAccent },
    locateNote: { color: colors.danger, fontSize: 12, lineHeight: 17, marginTop: 6 },
    sheetWrap: {
      marginTop: -22,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
    },
    sheet: {
      overflow: 'hidden' as const,
      backgroundColor: colors.elevated,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 20,
      paddingBottom: HOME_SHEET_BOTTOM_PADDING,
    },
    handleBlock: { paddingTop: 8 },
    searchBlock: { position: 'relative' as const },
    searchCover: { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0 },
    dragHint: {
      textAlign: 'center' as const,
      color: colors.placeholder,
      fontSize: 11,
      fontWeight: '600' as const,
      letterSpacing: 0.2,
      lineHeight: 16,
    },
    sheetScroll: { flex: 1, minHeight: 0 },
    sheetContent: { paddingBottom: 28 },
    skeletonBlock: { gap: 10, marginBottom: 14 },
    welcome: {
      fontSize: 13,
      fontWeight: '700' as const,
      letterSpacing: 0.4,
      color: colors.orange,
    },
    prompt: {
      color: colors.title,
      fontSize: 26,
      fontWeight: '700' as const,
      letterSpacing: -0.6,
      marginTop: 4,
      marginBottom: 14,
      lineHeight: 32,
    },
    liveCard: {
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderLeftWidth: 3,
      borderLeftColor: colors.orange,
    },
    liveKicker: { color: colors.orange, fontSize: 11, fontWeight: '800' as const, letterSpacing: 1.1 },
    liveTitle: { color: colors.title, fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.2, marginTop: 4 },
    liveBody: { color: colors.inkSecondary, fontSize: 13, lineHeight: 18, marginTop: 4 },
    gameCard: { backgroundColor: colors.orangeSoft, borderLeftColor: colors.purple },
    gameDetail: { color: colors.orange, fontSize: 13, fontWeight: '700' as const, marginTop: 4 },
    search: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      paddingHorizontal: 16,
      minHeight: 56,
      backgroundColor: colors.input,
    },
    searchMark: { width: 10, height: 10, borderRadius: 3, backgroundColor: colors.orange },
    searchInput: { flex: 1, minWidth: 0, fontSize: 17, fontWeight: '600' as const, color: colors.ink, paddingVertical: 14 },
    searchLink: { alignSelf: 'flex-start' as const, paddingVertical: 10, marginTop: 2 },
    searchLinkText: { color: colors.orange, fontWeight: '700' as const, fontSize: 14, letterSpacing: -0.1 },
    sectionLabel: {
      marginTop: 18,
      marginBottom: 10,
      fontSize: 13,
      fontWeight: '700' as const,
      letterSpacing: 0.2,
      color: colors.title,
    },
    actions: { flexDirection: 'row' as const, gap: 10 },
    actionCol: { flex: 1, gap: 10 },
    action: {
      backgroundColor: colors.card,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    actionIcon: { marginBottom: 10 },
    actionLabel: { fontSize: 14, fontWeight: '700' as const, letterSpacing: -0.2, color: colors.ink },
    actionDetail: { fontSize: 12, color: colors.inkSecondary, marginTop: 2 },
    shortcuts: { gap: 10, paddingRight: 4 },
    shortcut: {
      width: 132,
      padding: 14,
      borderRadius: 18,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    shortcutIcon: { fontSize: 20, marginBottom: 10 },
    shortcutLabel: { fontWeight: '700' as const, fontSize: 14, letterSpacing: -0.2, color: colors.ink },
    shortcutSub: { fontSize: 12, color: colors.inkSecondary, marginTop: 3 },
    keys: { color: colors.danger, fontSize: 12, marginTop: 12, lineHeight: 17 },
    studentCard: {
      marginTop: 18,
      borderRadius: 18,
      padding: 14,
      backgroundColor: colors.purpleSoft,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    studentOn: { backgroundColor: colors.orangeSoft, borderColor: colors.orange },
    gameday: {
      marginTop: 12,
      marginBottom: 8,
      borderRadius: 18,
      padding: 14,
      backgroundColor: colors.orangeSoft,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 12,
    },
    offerIcon: {
      width: 42,
      height: 42,
      borderRadius: 14,
      backgroundColor: colors.card,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    gamedayCopy: { flex: 1 },
    gamedayTitle: { fontWeight: '700' as const, fontSize: 15, letterSpacing: -0.2, color: colors.ink },
    gamedayBody: { fontSize: 13, lineHeight: 18, color: colors.inkSecondary, marginTop: 2 },
    gamedayBtn: { backgroundColor: colors.purple, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
    gamedayBtnText: { color: colors.onAccent, fontWeight: '700' as const, fontSize: 12 },
  }
}
