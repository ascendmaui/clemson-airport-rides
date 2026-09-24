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
import { CampusMap } from '@/components/CampusMap'
import type { CampusMapHandle, LatLng, MapKind } from '@/components/mapTypes'
import { mapKindLabel } from '@/components/mapTypes'
import { MainTabs } from '@/components/MainTabs'
import { Skeleton } from '@/components/Skeleton'
import { loadBusySpots, type BusySpot } from '@/lib/busySpots'
import { useAuth } from '@/lib/auth'
import { playTigerCue, tapHaptic } from '@/lib/feedback'
import { displayFirstName } from 'rides-native/authErrors'
import { campusOverlays } from 'rides-native/riderShell.js'
import { HEAT_WINDOWS, SHORTCUTS } from 'rides-native/places.js'
import { hotCatalogPlaces, lookupCatalogPlace, searchCatalogPlaces } from 'rides-native/shared/carpool.js'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

const MAP_KINDS: MapKind[] = ['standard', 'satellite', 'hybrid']

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
  const [gameDay, setGameDay] = useState(overlays.gameDay)
  const [surge, setSurge] = useState(overlays.surge)

  const name = user
    ? displayFirstName(user.user_metadata?.full_name || user.email?.split('@')[0], 'Tiger')
    : 'Tiger'
  const initial = name.slice(0, 1).toUpperCase()

  const minMap = Math.round(windowH * 0.28)
  const maxMap = Math.round(windowH * 0.58)
  const mapH = useRef(new Animated.Value(minMap)).current
  const limits = useRef({ min: minMap, max: maxMap })
  limits.current = { min: minMap, max: maxMap }
  const dragStart = useRef(minMap)
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderGrant: () => {
        mapH.stopAnimation((value) => {
          dragStart.current = value
        })
      },
      onPanResponderMove: (_, gesture) => {
        const { min, max } = limits.current
        const next = Math.min(max, Math.max(min, dragStart.current + gesture.dy))
        mapH.setValue(next)
      },
      onPanResponderRelease: (_, gesture) => {
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
          mapType={mapType}
          gameDay={gameDay}
          surge={surge}
          userCoordinate={userCoord}
        />
        <View pointerEvents="box-none" style={[styles.mapChrome, { paddingTop: insets.top + 8 }]}>
          <View style={styles.topBar}>
            <View style={[styles.brand, lift(colors, 'float')]}>
              <Text style={styles.brandKicker}>RIDE • GAME • REPEAT</Text>
              <Text style={styles.brandTitle}>Clemson <Text style={styles.brandSoft}>RIDES</Text></Text>
              <View style={styles.brandPill}>
                <Text style={styles.brandPillText}>TIGERS GET YOU THERE</Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Account"
              onPress={() => {
                void tapHaptic()
                router.push('/account')
              }}
              style={[styles.avatar, lift(colors, 'rest')]}
            >
              <Text style={styles.avatarText}>{initial}</Text>
            </Pressable>
          </View>
          <View style={styles.mapControls}>
            <View style={styles.kindRow}>
              {MAP_KINDS.map((kind) => {
                const on = mapType === kind
                return (
                  <Pressable key={kind} onPress={() => setMapType(kind)} style={[styles.kindChip, on && styles.kindOn]}>
                    <Text style={[styles.kindText, on && styles.kindTextOn]}>{mapKindLabel(kind)}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Pressable onPress={onLocate} style={[styles.locate, lift(colors, 'rest')]} accessibilityRole="button" accessibilityLabel="Center on me">
              <Text style={styles.locateText}>{locating ? '…' : '◎'}</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>

      <View style={styles.busyStrip}>
        <View style={styles.mapHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.mapTitle}>Campus map</Text>
            <Text style={styles.busyDays}>Busy days</Text>
          </View>
          <Pressable
            onPress={() => {
              void tapHaptic()
              setShowBusy((value) => !value)
            }}
            style={[styles.busy, showBusy && styles.busyOn]}
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
              <Pill label={gameDay ? 'Game day · On' : 'Game day'} active={gameDay} onPress={() => setGameDay((value) => !value)} />
              <Pill label={surge ? 'Surge · On' : 'Surge'} active={surge} onPress={() => setSurge((value) => !value)} />
            </ScrollView>
            <Text style={styles.caption}>
              {showBusy ? caption : 'Busy areas are hidden.'}
              {showBusy && blended ? <Text style={styles.live}>  Live + typical</Text> : null}
              {gameDay ? '  Game day overlay' : ''}
              {surge ? `  ${overlays.surgeLabel || 'Surge overlay'}` : ''}
            </Text>
          </>
        )}
        {locateNote ? <Text style={styles.locateNote}>{locateNote}</Text> : null}
      </View>

      <View style={styles.sheet}>
        <View {...pan.panHandlers} accessibilityLabel="Drag down to expand the map" accessibilityRole="adjustable">
          <SheetHandle />
          <Text style={styles.dragHint}>Drag down to expand the map</Text>
        </View>
        <ScrollView
          style={styles.sheetScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.orange}
              onRefresh={() => {
                setRefreshing(true)
                reloadSpots(heatWindow).finally(() => setRefreshing(false))
              }}
            />
          )}
        >
          {spotsLoading ? (
            <View style={styles.skeletonBlock}>
              <Skeleton height={26} width="55%" />
              <Skeleton height={16} width="72%" />
              <Skeleton height={48} />
            </View>
          ) : (
            <>
              <Text style={styles.welcome}>Welcome, {name}</Text>
              <Text style={styles.prompt}>Where are you headed, Tiger?</Text>
            </>
          )}
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Campus, GSP, CLT…"
            placeholderTextColor={colors.placeholder}
            style={[styles.search, lift(colors, 'rest')]}
            autoCorrect={false}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {suggestions.map((stop) => (
              <Pressable
                key={stop.id}
                accessibilityRole="button"
                onPress={() => {
                  setQuery(stop.label)
                  setDestError(null)
                  goSearch(stop.label)
                }}
                style={[styles.destChip, query === stop.label && styles.destChipOn]}
              >
                <Text style={[styles.destChipText, query === stop.label && styles.destChipTextOn]}>{stop.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {query.trim().length >= 2 && suggestions.length === 0 ? (
            <Text style={styles.locateNote}>No campus or airport match. Try Grand Marc, the stadium, or GSP.</Text>
          ) : null}
          <Pressable accessibilityRole="button" onPress={() => goSearch()} style={styles.searchLink}>
            <Text style={styles.searchLinkText}>Search destination →</Text>
          </Pressable>
          {destError ? <Text style={styles.locateNote}>{destError}</Text> : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            <Pill label="🕐  Schedule a ride" onPress={() => router.push('/schedule')} />
            <Pill label="👥  Carpool · split the surge" onPress={() => router.push('/friends')} />
            <Pill label="🧾  Your rides" onPress={() => router.push('/history')} />
            <Pill label="🛡  Safety" onPress={() => router.push('/safety')} />
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shortcuts}>
            {SHORTCUTS.map((shortcut) => (
              <Pressable key={shortcut.id} onPress={() => goSearch(shortcut.sub)} style={[styles.shortcut, lift(colors, 'rest')]}>
                <Text style={styles.shortcutIcon}>{shortcut.icon}</Text>
                <Text style={styles.shortcutLabel}>{shortcut.label}</Text>
                <Text style={styles.shortcutSub}>{shortcut.sub}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {!configured ? (
            <Text style={styles.keys}>
              This build needs EXPO_PUBLIC_SUPABASE_ANON_KEY as an EAS environment variable before sign-in works.
            </Text>
          ) : null}

          <Pressable
            onPress={() => {
              void playTigerCue()
              router.push('/friends')
            }}
            style={[styles.gameday, lift(colors, 'rest')]}
          >
            <Text style={styles.gamedayIcon}>🏈</Text>
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
      <MainTabs active="home" />
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    mapSlot: { backgroundColor: colors.mapFallback, overflow: 'hidden' as const },
    mapChrome: { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'space-between' as const },
    topBar: {
      paddingHorizontal: 16,
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'flex-start' as const,
    },
    brand: {
      width: '52%' as const,
      maxWidth: 220,
      minHeight: 96,
      borderRadius: 18,
      backgroundColor: colors.orange,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 12,
      justifyContent: 'flex-end' as const,
    },
    brandKicker: { color: colors.onAccent, fontSize: 9, fontWeight: '700' as const, letterSpacing: 1.4, marginBottom: 4 },
    brandTitle: { color: colors.onAccent, fontSize: 18, fontWeight: '800' as const },
    brandSoft: { fontWeight: '700' as const },
    brandPill: {
      marginTop: 8,
      alignSelf: 'flex-start' as const,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: 'rgba(255,255,255,0.2)',
    },
    brandPillText: { color: colors.onAccent, fontSize: 9, fontWeight: '700' as const, letterSpacing: 0.4 },
    avatar: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: colors.purple,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderWidth: 2,
      borderColor: colors.onAccent,
    },
    avatarText: { color: colors.onAccent, fontWeight: '800' as const, fontSize: 18 },
    mapControls: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'flex-end' as const,
      paddingHorizontal: 12,
      paddingBottom: 10,
    },
    kindRow: { flexDirection: 'row' as const, gap: 6 },
    kindChip: {
      backgroundColor: colors.card,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    kindOn: { backgroundColor: colors.purple },
    kindText: { color: colors.link, fontSize: 11, fontWeight: '800' as const },
    kindTextOn: { color: colors.onAccent },
    locate: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.card,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    locateText: { color: colors.orange, fontSize: 22, fontWeight: '800' as const },
    busyStrip: {
      backgroundColor: colors.card,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 6,
    },
    mapHead: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, gap: 8 },
    mapTitle: { fontWeight: '800' as const, fontSize: 15, color: colors.ink },
    busyDays: { color: colors.inkSecondary, fontSize: 12, fontWeight: '700' as const },
    busy: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.purpleSoft },
    busyOn: { backgroundColor: colors.orange },
    busyText: { color: colors.link, fontSize: 12, fontWeight: '700' as const },
    busyTextOn: { color: colors.onAccent },
    row: { gap: 8, paddingVertical: 4 },
    caption: { color: colors.inkSecondary, fontSize: 12, lineHeight: 17 },
    live: { color: colors.link, fontWeight: '700' as const },
    destChip: {
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.chip,
    },
    destChipOn: { backgroundColor: colors.purple, borderColor: colors.purple },
    destChipText: { color: colors.link, fontWeight: '700' as const, fontSize: 12 },
    destChipTextOn: { color: colors.onAccent },
    locateNote: { color: colors.danger, fontSize: 12 },
    sheet: {
      flex: 1,
      backgroundColor: colors.elevated,
      paddingHorizontal: 20,
      paddingTop: 8,
    },
    dragHint: { textAlign: 'center' as const, color: colors.placeholder, fontSize: 11, fontWeight: '700' as const, marginBottom: 6 },
    sheetScroll: { flex: 1 },
    skeletonBlock: { gap: 10, marginBottom: 12 },
    welcome: { fontSize: 24, fontWeight: '600' as const, letterSpacing: -0.4, color: colors.title },
    prompt: { color: colors.inkSecondary, fontSize: 15, marginTop: 4, marginBottom: 12 },
    search: {
      borderWidth: 1.5,
      borderColor: colors.orange,
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 16,
      color: colors.ink,
      backgroundColor: colors.input,
    },
    searchLink: { paddingVertical: 10 },
    searchLinkText: { color: colors.orange, fontWeight: '700' as const, fontSize: 13 },
    shortcuts: { gap: 10, paddingTop: 10 },
    shortcut: {
      minWidth: 118,
      padding: 14,
      borderRadius: 16,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    shortcutIcon: { fontSize: 22, marginBottom: 8 },
    shortcutLabel: { fontWeight: '600' as const, fontSize: 13, color: colors.ink },
    shortcutSub: { fontSize: 11, color: colors.placeholder, marginTop: 2 },
    keys: { color: colors.danger, fontSize: 12, marginTop: 8, lineHeight: 17 },
    gameday: {
      marginTop: 14,
      marginBottom: 16,
      borderRadius: 18,
      padding: 14,
      backgroundColor: colors.orangeSoft,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 10,
    },
    gamedayIcon: { fontSize: 24 },
    gamedayCopy: { flex: 1 },
    gamedayTitle: { fontWeight: '700' as const, fontSize: 15, color: colors.ink },
    gamedayBody: { fontSize: 13, color: colors.inkSecondary, marginTop: 2 },
    gamedayBtn: { backgroundColor: colors.purple, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
    gamedayBtnText: { color: colors.onAccent, fontWeight: '700' as const, fontSize: 12 },
  }
}
