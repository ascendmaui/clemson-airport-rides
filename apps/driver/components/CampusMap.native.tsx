import { useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import Constants from 'expo-constants'
import MapView, { Circle, Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps'
import { ANDROID_MAP_UNAVAILABLE, googleMapStyle, nativeMapTilesReady } from 'rides-native/googleMapChrome.js'
import { heatColor } from 'rides-native/heat.js'
import { DOWNTOWN, ORANGE, PURPLE, STADIUM } from 'rides-native/places.js'
import type { BusySpot } from '@/lib/busySpots'
import { describeCell, type DemandCell } from 'rides-native/demandHeat.js'
import { DemandHeatLayer } from './DemandHeatLayer'
import type { MapPin } from './CampusMap'

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
  const markers = pins?.length
    ? pins
    : [
        { id: 'stadium', latitude: STADIUM.latitude, longitude: STADIUM.longitude, title: 'Memorial Stadium', pinColor: ORANGE },
        { id: 'downtown', latitude: DOWNTOWN.latitude, longitude: DOWNTOWN.longitude, title: 'Downtown Clemson', pinColor: PURPLE },
      ]
  const focus = center || markers[0]

  const pinKey = (pins || []).map((pin: MapPin) => `${pin.id}:${pin.latitude.toFixed(4)},${pin.longitude.toFixed(4)}`).join('|')
  const centerKey = center ? `${center.latitude.toFixed(4)},${center.longitude.toFixed(4)}` : ''
  const heatKey = showHeat ? heatWindow : ''

  useEffect(() => {
    if (!showHeat) setSelected(null)
  }, [showHeat])

  // Keep the tapped card in sync with fresh data; drop it if the zone cooled off.
  const live = selected ? demandCells.find((cell: DemandCell) => cell.id === selected.id && !cell.fading) || null : null
  const info = live ? describeCell(live, center ? { lat: center.latitude, lng: center.longitude } : null) : null

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
        customMapStyle={googleMapStyle(colorScheme)}
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
          <Marker
            key={pin.id}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            title={pin.title}
            description="Tap to accept"
            anchor={{ x: 0.5, y: 0.5 }}
            onPress={() => onPinPress?.(pin.id)}
          >
            <View style={[styles.requestDot, { backgroundColor: pin.pinColor || PURPLE }]} />
          </Marker>
        ) : (
          <Marker
            key={pin.id}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            title={pin.title}
            pinColor={pin.pinColor || ORANGE}
            onPress={() => onPinPress?.(pin.id)}
          />
        ))}
      </MapView>
      {showHeat && peak ? (
        <View pointerEvents="none" style={[styles.peakBadge, { backgroundColor: colorScheme === 'dark' ? 'rgba(255,64,160,0.9)' : 'rgba(122,20,92,0.9)' }]}>
          <Text style={styles.peakText}>Peak mode · 30 min window</Text>
        </View>
      ) : null}
      {info ? (
        <View
          style={[styles.heatCard, { backgroundColor: colorScheme === 'dark' ? '#1C1C22' : '#FFFFFF' }]}
          accessibilityRole="summary"
          accessibilityLabel={`${info.title}. ${info.estimate}. ${info.distance || ''}`}
        >
          <Text style={[styles.heatCardTitle, { color: colorScheme === 'dark' ? '#FFFFFF' : '#1B1B1F' }]}>{info.title}</Text>
          <Text style={styles.heatCardEstimate}>{info.estimate}</Text>
          {info.detail ? <Text style={[styles.heatCardDetail, { color: colorScheme === 'dark' ? '#C9C9D1' : '#5A5A66' }]}>{info.detail}</Text> : null}
          {info.distance ? <Text style={[styles.heatCardDetail, { color: colorScheme === 'dark' ? '#C9C9D1' : '#5A5A66' }]}>{info.distance}</Text> : null}
          <Text onPress={() => setSelected(null)} style={styles.heatCardClose} accessibilityRole="button" accessibilityLabel="Close demand details">Close</Text>
        </View>
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
  peakBadge: { position: 'absolute', top: 120, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  peakText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  heatCard: { position: 'absolute', left: 16, right: 16, top: 160, borderRadius: 16, padding: 14, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  heatCardTitle: { fontSize: 16, fontWeight: '800' },
  heatCardEstimate: { fontSize: 14, fontWeight: '700', color: '#F56600', marginTop: 2 },
  heatCardDetail: { fontSize: 12, marginTop: 4 },
  heatCardClose: { position: 'absolute', right: 14, top: 14, color: '#F56600', fontWeight: '800', fontSize: 13 },
  unavailable: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F4F5F8',
  },
  unavailableTitle: { fontSize: 16, fontWeight: '800', color: '#522D80', marginBottom: 8 },
  unavailableBody: { fontSize: 14, lineHeight: 20, textAlign: 'center', color: '#5B6472' },
  tigerChip: {
    backgroundColor: '#F56600',
    borderColor: '#522D80',
    borderWidth: 2,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tigerChipPreview: { backgroundColor: '#522D80' },
  tigerChipText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  zone: { position: 'absolute', left: 16, top: 88, right: 16, alignItems: 'flex-start' },
  requestDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  zoneText: {
    backgroundColor: ORANGE,
    color: '#fff',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '800',
  },
})
