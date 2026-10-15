import { useEffect, useMemo, useRef, useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Constants from 'expo-constants'
import MapView, { Circle, Marker, Polyline, PROVIDER_DEFAULT, type MapStyleElement } from 'react-native-maps'
import { ANDROID_MAP_UNAVAILABLE, googleMapStyle, nativeMapTilesReady } from 'rides-native/googleMapChrome.js'
import { heatColor } from 'rides-native/heat.js'
import { DOWNTOWN, ORANGE, PURPLE, STADIUM } from 'rides-native/places.js'
import { color, shadowStyle } from 'rides-native/shared/theme.js'
import type { BusySpot } from '@/lib/busySpots'
import { describeCell, heatRgb, type DemandCell } from 'rides-native/demandHeat.js'
import { DemandHeatLayer } from './DemandHeatLayer'
import { StillMarker } from './StillMarker'
import { markerLookKey } from '@/lib/markerRedraw'
import { GLYPHS, Glyph, ION_ALIASES } from 'rides-native/icons'
import type { MapPin } from './CampusMap'

const HEAT_LEGEND_STOPS = [0.1, 0.4, 0.7, 1]

const FALLBACK_MARKERS: MapPin[] = [
  { id: 'stadium', latitude: STADIUM.latitude, longitude: STADIUM.longitude, title: 'Memorial Stadium', pinColor: ORANGE },
  { id: 'downtown', latitude: DOWNTOWN.latitude, longitude: DOWNTOWN.longitude, title: 'Downtown Clemson', pinColor: PURPLE },
]

/** Shared icon set when the marker glyph has one; Ionicons only for the few it lacks. */
function hasSharedGlyph(name: string) {
  return Boolean((GLYPHS as Record<string, unknown>)[name] || (ION_ALIASES as Record<string, string>)[name])
}

function rgba(hex: string, alpha: number) {
  const raw = hex.replace('#', '')
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export function CampusMap({
  pins,
  center,
  route,
  colorScheme = 'light',
  focusToken = 0,
  spots = [],
  showHeat = false,
  heatWindow = 'now',
  gameDay = false,
  gameDayLabel = null,
  lockOnCenter = false,
  onPinPress,
  showsUserLocation = false,
  demandCells = [],
  peak = false,
}: {
  pins?: MapPin[]
  center?: { latitude: number; longitude: number } | null
  route?: { latitude: number; longitude: number }[]
  colorScheme?: 'light' | 'dark'
  focusToken?: number
  spots?: BusySpot[]
  showHeat?: boolean
  heatWindow?: string
  gameDay?: boolean
  gameDayLabel?: string | null
  lockOnCenter?: boolean
  onPinPress?: (id: string) => void
  showsUserLocation?: boolean
  demandCells?: DemandCell[]
  peak?: boolean
}) {
  const mapRef = useRef<MapView>(null)
  const [selected, setSelected] = useState<DemandCell | null>(null)
  const pinsRef = useRef(pins)
  const centerRef = useRef(center)
  pinsRef.current = pins
  centerRef.current = center
  const pinKey = (pins || []).map((pin: MapPin) => `${pin.id}:${pin.latitude.toFixed(4)},${pin.longitude.toFixed(4)}`).join('|')
  const pinLookKey = (pins || []).map((pin: MapPin) => markerLookKey([pin.id, pin.kind, pin.title, pin.pinColor, pin.marker?.fill, pin.marker?.accent, pin.marker?.pattern, pin.marker?.glyph])).join('||')
  // Same pins (position to ~1 m and look) → same marker list, so the map does not rebuild markers each render.
  const pinPlaceKey = (pins || []).map((pin: MapPin) => `${pin.id}:${pin.latitude.toFixed(5)},${pin.longitude.toFixed(5)}`).join('|')
  const markers = useMemo(() => (pins?.length ? pins : FALLBACK_MARKERS), [pinPlaceKey, pinLookKey])
  const focus = center || markers[0]

  const centerKey = center ? `${center.latitude.toFixed(4)},${center.longitude.toFixed(4)}` : ''
  const heatKey = showHeat ? heatWindow : ''

  useEffect(() => {
    if (!showHeat) setSelected(null)
  }, [showHeat])

  // Keep the tapped card in sync with fresh data; drop it if the zone cooled off.
  const live = selected ? demandCells.find((cell: DemandCell) => cell.id === selected.id && !cell.fading) || null : null
  const info = live ? describeCell(live, center ? { lat: center.latitude, lng: center.longitude } : null) : null
  const cardIn = useRef(new Animated.Value(0)).current
  const darkMap = colorScheme === 'dark'

  useEffect(() => {
    if (!live) {
      cardIn.setValue(0)
      return undefined
    }
    let cancelled = false
    const play = (reduce: boolean) => {
      if (cancelled) return
      if (reduce) {
        cardIn.setValue(1)
        return
      }
      cardIn.setValue(0)
      Animated.timing(cardIn, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
    }
    const pending = AccessibilityInfo.isReduceMotionEnabled?.()
    if (pending && typeof pending.then === 'function') pending.then(play).catch(() => play(false))
    else play(false)
    return () => { cancelled = true }
  }, [cardIn, live?.id])

  useEffect(() => {
    if (!mapRef.current) return
    if (lockOnCenter && centerRef.current) {
      const next = centerRef.current
      mapRef.current.animateToRegion(
        {
          latitude: next.latitude,
          longitude: next.longitude,
          latitudeDelta: 0.045,
          longitudeDelta: 0.045,
        },
        450,
      )
      return
    }
    if (showHeat && spots.length > 1) {
      mapRef.current.fitToCoordinates(
        spots.map((spot: BusySpot) => ({ latitude: spot.lat, longitude: spot.lng })),
        { edgePadding: { top: 80, right: 40, bottom: 220, left: 40 }, animated: true },
      )
      return
    }
    const list = (pinsRef.current || []).filter((pin: MapPin) => Number.isFinite(pin.latitude) && Number.isFinite(pin.longitude))
    if (list.length > 1) {
      mapRef.current.fitToCoordinates(
        list.map((pin: MapPin) => ({ latitude: pin.latitude, longitude: pin.longitude })),
        { edgePadding: { top: 80, right: 40, bottom: 220, left: 40 }, animated: true },
      )
      return
    }
    const next = centerRef.current
    if (!next) return
    mapRef.current.animateToRegion(
      {
        latitude: next.latitude,
        longitude: next.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      },
      450,
    )
  }, [centerKey, pinKey, focusToken, heatKey, showHeat, lockOnCenter])

  const tilesReady = nativeMapTilesReady(Platform.OS, {
    env: typeof process !== 'undefined' ? process.env : {},
    manifestKey: Constants.expoConfig?.android?.config?.googleMaps?.apiKey,
  })
  if (!tilesReady) {
    return (
      <View style={[styles.fill, styles.unavailable]}>
        <Text style={styles.unavailableTitle}>Map unavailable</Text>
        <Text style={styles.unavailableBody}>{ANDROID_MAP_UNAVAILABLE}</Text>
      </View>
    )
  }

  return (
    <View style={styles.fill}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: focus.latitude,
          longitude: focus.longitude,
          latitudeDelta: showHeat ? 0.028 : 0.04,
          longitudeDelta: showHeat ? 0.028 : 0.04,
        }}
        mapType="standard"
        userInterfaceStyle={colorScheme}
        customMapStyle={googleMapStyle(colorScheme) as MapStyleElement[] | undefined}
        rotateEnabled={false}
        pitchEnabled={false}
        showsUserLocation={showsUserLocation}
      >
        {showHeat ? (
          <DemandHeatLayer cells={demandCells} scheme={colorScheme} onPress={setSelected} />
        ) : null}
        {showHeat && !demandCells.length
          ? spots.slice(0, 12).map((spot: BusySpot) => (
              <Circle
                key={spot.id}
                center={{ latitude: spot.lat, longitude: spot.lng }}
                radius={spot.radius}
                fillColor={rgba(heatColor(spot.intensity), colorScheme === 'dark' ? 0.22 : 0.16)}
                strokeColor="transparent"
                strokeWidth={0}
              />
            ))
          : null}
        {route && route.length > 1 ? (
          <Polyline coordinates={route} strokeColor={ORANGE} strokeWidth={4} />
        ) : null}
        {gameDay ? (
          <Circle
            center={STADIUM}
            radius={420}
            fillColor="rgba(245,102,0,0.28)"
            strokeColor={ORANGE}
            strokeWidth={2}
          />
        ) : null}
        {markers.map((pin: MapPin) => pin.kind === 'request' ? (
          <StillMarker
            key={pin.id}
            lookKey={markerLookKey([pin.pinColor])}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            title={pin.title}
            description="Tap to accept"
            anchor={{ x: 0.5, y: 0.5 }}
            onPress={() => onPinPress?.(pin.id)}
          >
            <View style={[styles.requestDot, { backgroundColor: pin.pinColor || PURPLE }]} />
          </StillMarker>
        ) : pin.kind === 'self' && pin.marker ? (
          <StillMarker
            key={pin.id}
            lookKey={markerLookKey([pin.marker.fill, pin.marker.accent, pin.marker.pattern, pin.marker.glyph])}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            title={pin.title}
            anchor={{ x: 0.5, y: 0.5 }}
            onPress={() => onPinPress?.(pin.id)}
          >
            <View style={[styles.carMarker, { backgroundColor: pin.marker.fill, borderColor: pin.marker.accent, borderStyle: pin.marker.pattern === 'check' ? 'dashed' : 'solid', borderWidth: pin.marker.pattern === 'ring' ? 4 : 2 }]}>
              {pin.marker.pattern === 'stripe' ? <View style={[styles.carStripe, { backgroundColor: pin.marker.accent }]} /> : null}
              {hasSharedGlyph(pin.marker.glyph)
                ? <Glyph name={pin.marker.glyph} size={18} color={pin.marker.pattern === 'check' ? pin.marker.accent : '#FFFFFF'} />
                : <Ionicons name={pin.marker.glyph as keyof typeof Ionicons.glyphMap} size={18} color={pin.marker.pattern === 'check' ? pin.marker.accent : '#FFFFFF'} />}
            </View>
          </StillMarker>
        ) : (
          <Marker
            key={pin.id}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            title={pin.title}
            pinColor={pin.pinColor || ORANGE}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
            onPress={() => onPinPress?.(pin.id)}
          />
        ))}
      </MapView>
      {showHeat && peak ? (
        <View pointerEvents="none" style={styles.peakBadge}>
          <Text style={styles.peakText}>Peak mode · 30 min window</Text>
        </View>
      ) : null}
      {showHeat ? (
        <View pointerEvents="none" style={[styles.heatLegend, { backgroundColor: darkMap ? 'rgba(22,18,31,0.9)' : 'rgba(255,255,255,0.92)' }]} accessibilityLabel="Demand heat map legend, low to high">
          <Text style={[styles.heatLegendText, { color: darkMap ? '#D5D0DC' : '#3E4654' }]}>Demand</Text>
          <View style={styles.heatLegendRamp}>
            {HEAT_LEGEND_STOPS.map((v) => (
              <View key={v} style={[styles.heatLegendSwatch, { backgroundColor: `rgb(${heatRgb(v, colorScheme).join(',')})` }]} />
            ))}
          </View>
          <Text style={[styles.heatLegendText, { color: darkMap ? '#D5D0DC' : '#3E4654' }]}>Low · High</Text>
        </View>
      ) : null}
      {info ? (
        <Animated.View
          style={[
            styles.heatCard,
            {
              backgroundColor: darkMap ? '#16121F' : '#FFFFFF',
              borderColor: darkMap ? 'rgba(255,255,255,0.14)' : 'rgba(82,45,128,0.12)',
              opacity: cardIn,
              transform: [{ translateY: cardIn.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
            },
          ]}
          accessibilityRole="summary"
          accessibilityLabel={`${info.title}. ${info.estimate}. ${info.distance || ''}`}
        >
          <Text style={[styles.heatCardTitle, { color: darkMap ? '#FFFFFF' : '#1B1B1F' }]}>{info.title}</Text>
          <Text style={[styles.heatCardEstimate, { color: darkMap ? '#FFC9A3' : '#9A3F00' }]}>{info.estimate}</Text>
          {info.detail ? <Text style={[styles.heatCardDetail, { color: darkMap ? '#D5D0DC' : '#3E4654' }]}>{info.detail}</Text> : null}
          {info.distance ? <Text style={[styles.heatCardDetail, { color: darkMap ? '#D5D0DC' : '#3E4654' }]}>{info.distance}</Text> : null}
          <Pressable
            onPress={() => setSelected(null)}
            style={styles.heatCardClose}
            accessibilityRole="button"
            accessibilityLabel="Close demand details"
            hitSlop={8}
          >
            <Text style={[styles.heatCardCloseText, { color: darkMap ? '#FFC9A3' : '#9A3F00' }]}>Close</Text>
          </Pressable>
        </Animated.View>
      ) : null}
      {gameDay ? (
        <View pointerEvents="none" style={styles.zone}>
          <Text style={styles.zoneText}>{gameDayLabel || 'Game day'}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  heatLegend: { position: 'absolute', left: 12, top: 160, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, alignItems: 'center', gap: 4 },
  heatLegendRamp: { flexDirection: 'row', borderRadius: 4, overflow: 'hidden' },
  heatLegendSwatch: { width: 14, height: 8 },
  heatLegendText: { fontSize: 10, fontWeight: '700' },
  carMarker: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  carStripe: { position: 'absolute', width: 6, height: 40, transform: [{ rotate: '35deg' }], opacity: 0.6 },
  peakBadge: {
    position: 'absolute', top: 108, alignSelf: 'center',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: PURPLE,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)',
    ...shadowStyle(PURPLE, 'rest', 'dark'),
  },
  peakText: { color: color.white, fontWeight: '700', fontSize: 12, letterSpacing: 0.3 },
  heatCard: {
    position: 'absolute', left: 16, right: 16, top: 156,
    borderRadius: 22, padding: 16, paddingRight: 88, borderWidth: 1,
    ...shadowStyle(color.shadow, 'float'),
  },
  heatCardTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  heatCardEstimate: { fontSize: 14, fontWeight: '700', marginTop: 4, letterSpacing: -0.1 },
  heatCardDetail: { fontSize: 13, lineHeight: 18, marginTop: 6 },
  heatCardClose: { position: 'absolute', right: 6, top: 6, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  heatCardCloseText: { fontWeight: '700', fontSize: 13, letterSpacing: 0.2 },
  unavailable: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F4F5F8',
  },
  unavailableTitle: { fontSize: 16, fontWeight: '800', color: PURPLE, marginBottom: 8 },
  unavailableBody: { fontSize: 14, lineHeight: 20, textAlign: 'center', color: '#5B6472' },
  tigerChip: {
    backgroundColor: ORANGE,
    borderColor: PURPLE,
    borderWidth: 2,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tigerChipPreview: { backgroundColor: PURPLE },
  tigerChipText: { color: color.white, fontSize: 12, fontWeight: '800' },
  zone: { position: 'absolute', left: 16, top: 88, right: 16, alignItems: 'flex-start' },
  requestDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: color.white,
  },
  zoneText: {
    backgroundColor: ORANGE,
    color: color.white,
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '800',
  },
})
