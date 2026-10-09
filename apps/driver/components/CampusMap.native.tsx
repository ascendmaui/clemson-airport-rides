import { useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import Constants from 'expo-constants'
import MapView, { Circle, Marker, Polygon, Polyline, PROVIDER_DEFAULT } from 'react-native-maps'
import { ANDROID_MAP_UNAVAILABLE, googleMapStyle, nativeMapTilesReady } from 'rides-native/googleMapChrome.js'
import { heatColor } from 'rides-native/heat.js'
import { DOWNTOWN, ORANGE, PURPLE, STADIUM } from 'rides-native/places.js'
import type { BusySpot } from '@/lib/busySpots'
import { fetchTigerHeatMap } from 'rides-native/tigerHeatClient.js'
import { toNativeRing, type TigerHeatZone } from 'rides-native/tigerHeat.js'
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
}) {
  const mapRef = useRef<MapView>(null)
  const [tigerZones, setTigerZones] = useState<TigerHeatZone[]>([])
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
  const heatKey = showHeat ? spots.map((spot: BusySpot) => spot.id).join('|') : ''

  useEffect(() => {
    if (!showHeat) {
      setTigerZones([])
      return undefined
    }
    let alive = true
    fetchTigerHeatMap(heatWindow).then((result) => {
      if (alive) setTigerZones(result.zones || [])
    }).catch(() => {
      if (alive) setTigerZones([])
    })
    return () => {
      alive = false
    }
  }, [showHeat, heatWindow])

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
        {showHeat
          ? tigerZones.map((zone: TigerHeatZone) => (
              <Polygon
                key={`tiger-${zone.id}`}
                coordinates={toNativeRing(zone.polygon)}
                fillColor={zone.preview ? 'rgba(245,102,0,0.18)' : 'rgba(245,102,0,0.36)'}
                strokeColor="#522D80"
                strokeWidth={2}
              />
            ))
          : null}
        {showHeat
          ? tigerZones.map((zone: TigerHeatZone) => (
              <Polygon
                key={`tiger-inner-${zone.id}`}
                coordinates={toNativeRing(zone.innerPolygon)}
                fillColor="rgba(82,45,128,0.2)"
                strokeColor="#F56600"
                strokeWidth={1}
              />
            ))
          : null}
        {showHeat
          ? tigerZones.map((zone: TigerHeatZone) => (
              <Marker
                key={`tiger-label-${zone.id}`}
                coordinate={{ latitude: zone.lat, longitude: zone.lng }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
              >
                <View style={[styles.tigerChip, zone.preview ? styles.tigerChipPreview : null]}>
                  <Text style={styles.tigerChipText}>{zone.bonusLabel}</Text>
                </View>
              </Marker>
            ))
          : null}
        {showHeat
          ? spots.map((spot: BusySpot) => (
              <Circle
                key={spot.id}
                center={{ latitude: spot.lat, longitude: spot.lng }}
                radius={spot.radius}
                fillColor={rgba(heatColor(spot.intensity), 0.28)}
                strokeColor={heatColor(spot.intensity)}
                strokeWidth={1}
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
