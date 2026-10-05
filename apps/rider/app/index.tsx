import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Pill, SheetHandle } from '@/components/Button'
import { pressStyle, useEnterMotion } from '@/components/enter'
import { CampusMap } from '@/components/CampusMap'
import type { CampusMapHandle, LatLng, MapKind } from '@/components/mapTypes'
import { mapKindLabel } from '@/components/mapTypes'
import { MainTabs } from '@/components/MainTabs'
import { Skeleton } from '@/components/Skeleton'
import { loadBusySpots, type BusySpot } from '@/lib/busySpots'
import { useAuth } from '@/lib/auth'
import { setAuthNext } from '@/lib/authNext'
import { listScheduledTrips, type ScheduledRow } from '@/lib/scheduleApi'
import { playTigerCue, tapHaptic } from '@/lib/feedback'
import { displayFirstName } from 'rides-native/authErrors'
import { campusOverlays } from 'rides-native/riderShell.js'
import { loadGameDay } from 'rides-native/driverDesk'
import { gameDayNotice, type GameDayNotice } from 'rides-native/gameDayNotice.js'
import { studentSurfaceCopy } from 'rides-native/riderMoney.js'
import { dueScheduleReminders } from '../../../src/lib/scheduledRideModel.js'
import { supabase } from '@/lib/supabase'
import { useStudentStatus } from '@/lib/useStudentStatus'
import { RIDER_TRACK_STATUSES, riderLiveView } from 'rides-native/liveTrip'
import { HEAT_WINDOWS, SHORTCUTS } from 'rides-native/places.js'
import { hotCatalogPlaces, lookupCatalogPlace, searchCatalogPlaces } from 'rides-native/shared/carpool.js'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

const MAP_KINDS: MapKind[] = ['standard', 'satellite', 'hybrid']

const QUICK_ACTIONS = [
  { id: 'schedule', label: 'Schedule a ride', detail: 'Choose a time', icon: 'calendar-outline' as const, href: '/schedule' as const },
  { id: 'carpool', label: 'Carpool', detail: 'Split the surge', icon: 'people-outline' as const, href: '/friends' as const },
  { id: 'history', label: 'Your rides', detail: 'Trip history', icon: 'time-outline' as const, href: '/history' as const },
  { id: 'safety', label: 'Safety', detail: 'Audio, video, tracking, SOS', icon: 'shield-checkmark-outline' as const, href: '/safety' as const },
]

export default function RiderHome() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { height: windowH } = useWindowDimensions()
  const { user, configured } = useAuth()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const mapRef = useRef<CampusMapHandle>(null)
  const [query, setQuery] = useState('')
  const [destError, setDestError] = useState<string | null>(null)
  const [liveTrip, setLiveTrip] = useState<{ id: string; status: string | null; dropoff_label: string | null } | null>(null)
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
  const reminders = useMemo(() => dueScheduleReminders(scheduledRows, clock), [scheduledRows, clock])
  const chromeMotion = useEnterMotion(8)
  const sheetMotion = useEnterMotion(16)

  const name = user
    ? displayFirstName(user.user_metadata?.full_name || user.email?.split('@')[0], 'Tiger')
    : 'Tiger'
  const initial = name.slice(0, 1).toUpperCase()

  const minMap = Math.round(windowH * 0.38)
  const maxMap = Math.round(windowH * 0.64)
  const mapH = useRef(new Animated.Value(minMap)).current
  const limits = useRef({ min: minMap, max: maxMap })
  limits.current = { min: minMap, max: maxMap }
  const dragStart = useRef(minMap)
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_: any, gesture: { dx: number; dy: number; vy: number }) => Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderGrant: () => {
        mapH.stopAnimation((value: number) => {
          dragStart.current = value
        })
      },
      onPanResponderMove: (_: any, gesture: { dx: number; dy: number; vy: number }) => {
        const { min, max } = limits.current
        const next = Math.min(max, Math.max(min, dragStart.current + gesture.dy))
        mapH.setValue(next)
      },
      onPanResponderRelease: (_: any, gesture: { dx: number; dy: number; vy: number }) => {
        const { min, max } = limits.current
        const current = Math.min(max, Math.max(min, dragStart.current + gesture.dy))
        const expand = gesture.vy > 0.35 || (gesture.vy >= -0.35 && current > (min + max) / 2)
        Animated.spring(mapH, {
          toValue: expand ? max : min,
          useNativeDriver: false,
          friction: 7,
          tension: 80,
        }).start()
      },
    }),
  ).current

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
      return
    }
    try {
      const row = await loadGameDay(supabase)
      setGameNotice(gameDayNotice(row))
    } catch {
      setGameNotice(gameDayNotice(null))
    }
  }

  async function loadScheduledReminders() {
    if (!user?.id) {
      setScheduledRows([])
      return
    }
    try {
      setScheduledRows(await listScheduledTrips(user.id))
      setClock(new Date())
    } catch {
      setScheduledRows([])
    }
  }

  useEffect(() => {
    if (!user?.id || !supabase) {
      setLiveTrip(null)
      return undefined
    }
    let alive = true
    async function loadLive() {
      const { data } = await supabase!
        .from('trips')
        .select('id, status, dropoff_label')
        .eq('rider_id', user!.id)
        .in('status', [...RIDER_TRACK_STATUSES])
        .order('requested_at', { ascending: false })
        .limit(1)
      if (!alive) return
      const row = Array.isArray(data) ? data[0] : data
      setLiveTrip(row ? { id: row.id, status: row.status, dropoff_label: row.dropoff_label } : null)
    }
    void loadLive()
    const timer = setInterval(() => { void loadLive() }, 8000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [user?.id])

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
      } catch {
        if (alive) setGameNotice(gameDayNotice(null))
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
    }).catch(() => {
      if (alive) setScheduledRows([])
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
    }).catch(() => {
      if (alive) setSpotsLoading(false)
    })
    return () => {
      alive = false
    }
  }, [heatWindow])

  const goSearch = (dest?: string) => {
    if (dest) {
      const known = lookupCatalogPlace(dest)
      void tapHaptic()
      router.push({ pathname: '/confirm', params: { dest: known?.label || dest } })
      return
    }
    const typed = lookupCatalogPlace(query)
    if (!typed) {
      setDestError('Pick a campus or airport stop. Try Grand Marc, the stadium, or GSP.')
      return
    }
    setDestError(null)
    void tapHaptic()
    router.push({ pathname: '/confirm', params: { dest: typed.label } })
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
    <View style={styles.screen}>
      <Animated.View style={[styles.mapSlot, { height: mapH }]}>
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
                <Text style={styles.brandTitle}>Clemson <Text style={styles.brandSoft}>RIDES</Text></Text>
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
      </Animated.View>

      <Animated.View style={[styles.sheetWrap, lift(colors, 'float'), sheetMotion]}>
      <View style={styles.sheet}>
        <View {...pan.panHandlers} accessibilityLabel="Drag down to expand the map" accessibilityHint="Drag down to make the map taller" accessibilityRole="adjustable">
          <SheetHandle />
          <Text style={styles.dragHint}>Drag down to expand the map</Text>
        </View>
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.orange}
              onRefresh={() => {
                setRefreshing(true)
                Promise.all([
                  reloadSpots(heatWindow),
                  loadGameNotice(),
                  loadScheduledReminders(),
                ]).finally(() => setRefreshing(false))
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
            <>
              <Text style={styles.welcome}>Welcome, {name}</Text>
              <Text style={styles.prompt}>Where are you headed, Tiger?</Text>
              {liveTrip ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Live ride. ${riderLiveView(liveTrip.status).title}. Open tracking for ${liveTrip.dropoff_label || 'this trip'}.`}
                  accessibilityHint="Opens live trip tracking"
                  onPress={() => router.push({ pathname: '/requested', params: { trip: liveTrip.id, dest: liveTrip.dropoff_label || '' } })}
                  style={({ pressed }) => [styles.liveCard, lift(colors, 'rest'), pressStyle(pressed)]}
                >
                  <Text style={styles.liveKicker}>LIVE RIDE</Text>
                  <Text style={styles.liveTitle}>{riderLiveView(liveTrip.status).title}</Text>
                  <Text style={styles.liveBody}>Open tracking for {liveTrip.dropoff_label || 'this trip'}.</Text>
                </Pressable>
              ) : null}
            </>
          )}
          {gameNotice?.live ? (
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
          <View style={[styles.search, lift(colors, 'rest')]}>
            <View style={styles.searchMark} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Campus, GSP, CLT…"
              placeholderTextColor={colors.placeholder}
              style={styles.searchInput}
              autoCorrect={false}
              accessibilityLabel="Destination"
              accessibilityHint="Search a campus stop or airport"
            />
          </View>
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
            <Text style={styles.searchLinkText}>Search destination →</Text>
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
                    <View style={styles.actionIcon}>
                      <Ionicons name={action.icon} size={18} color={colors.orange} />
                    </View>
                    <Text style={styles.actionLabel}>{action.label}</Text>
                    <Text style={styles.actionDetail}>{action.detail}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Places</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shortcuts}>
            {SHORTCUTS.map((shortcut) => (
              <Pressable
                key={shortcut.id}
                onPress={() => goSearch(shortcut.sub)}
                style={({ pressed }) => [styles.shortcut, lift(colors, 'rest'), pressStyle(pressed)]}
                accessibilityRole="button"
                accessibilityLabel={`${shortcut.label}. ${shortcut.sub}`}
                accessibilityHint="Requests a ride to this place"
              >
                <Text style={styles.shortcutIcon}>{shortcut.icon}</Text>
                <Text style={styles.shortcutLabel}>{shortcut.label}</Text>
                <Text style={styles.shortcutSub}>{shortcut.sub}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={[styles.campusCard, lift(colors, 'rest')]}>
            <View style={styles.mapHead}>
              <View style={styles.campusCopy}>
                <Text style={styles.mapTitle}>Campus map</Text>
                <Text style={styles.busyDays}>Busy days</Text>
              </View>
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
            </View>
            {spotsLoading ? (
              <Skeleton height={32} width="70%" />
            ) : (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
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
              <Text style={styles.gamedayIcon}>🎓</Text>
            </View>
            <View style={styles.gamedayCopy}>
              <Text style={styles.gamedayTitle}>{studentOffer.title}</Text>
              <Text style={styles.gamedayBody}>{studentOffer.detail}</Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => {
              void playTigerCue()
              router.push('/friends')
            }}
            style={({ pressed }) => [styles.gameday, lift(colors, 'rest'), pressStyle(pressed)]}
            accessibilityRole="button"
            accessibilityLabel="Game day carpool. About 10 to 15 dollars each instead of 30 to 40."
            accessibilityHint="Opens carpools"
          >
            <View style={styles.offerIcon}>
              <Text style={styles.gamedayIcon}>🏈</Text>
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
      </View>
      </Animated.View>
      <MainTabs active="home" />
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    mapSlot: { backgroundColor: colors.mapFallback, overflow: 'hidden' as const },
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
      flex: 1,
      marginTop: -22,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
    },
    sheet: {
      flex: 1,
      overflow: 'hidden' as const,
      backgroundColor: colors.elevated,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 20,
      paddingTop: 8,
    },
    dragHint: {
      textAlign: 'center' as const,
      color: colors.placeholder,
      fontSize: 11,
      fontWeight: '600' as const,
      letterSpacing: 0.2,
      marginBottom: 8,
    },
    sheetScroll: { flex: 1 },
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
    actionIcon: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: colors.orangeSoft,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      marginBottom: 10,
    },
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
    gamedayIcon: { fontSize: 20 },
    gamedayCopy: { flex: 1 },
    gamedayTitle: { fontWeight: '700' as const, fontSize: 15, letterSpacing: -0.2, color: colors.ink },
    gamedayBody: { fontSize: 13, lineHeight: 18, color: colors.inkSecondary, marginTop: 2 },
    gamedayBtn: { backgroundColor: colors.purple, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
    gamedayBtnText: { color: colors.onAccent, fontWeight: '700' as const, fontSize: 12 },
  }
}
