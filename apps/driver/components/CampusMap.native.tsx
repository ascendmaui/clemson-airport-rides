import { useEffect, useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import MapView, { Circle, Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps'
import { heatColor } from 'rides-native/heat.js'
import { DOWNTOWN, ORANGE, PURPLE, STADIUM } from 'rides-native/places.js'
import type { BusySpot } from '@/lib/busySpots'
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
  gameDay = false,
  gameDayLabel = null,
}: {
  pins?: MapPin[]
  center?: { latitude: number; longitude: number } | null
  route?: { latitude: number; longitude: number }[]
  colorScheme?: 'light' | 'dark'
  focusToken?: number
  spots?: BusySpot[]
  showHeat?: boolean
  gameDay?: boolean
  gameDayLabel?: string | null
}) {
  const mapRef = useRef<MapView>(null)
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

  const pinKey = (pins || []).map((pin) => `${pin.id}:${pin.latitude.toFixed(4)},${pin.longitude.toFixed(4)}`).join('|')
  const centerKey = center ? `${center.latitude.toFixed(4)},${center.longitude.toFixed(4)}` : ''
  const heatKey = showHeat ? spots.map((spot) => spot.id).join('|') : ''

  useEffect(() => {
    if (!mapRef.current) return
    if (showHeat && spots.length > 1) {
      mapRef.current.fitToCoordinates(
        spots.map((spot) => ({ latitude: spot.lat, longitude: spot.lng })),
        { edgePadding: { top: 80, right: 40, bottom: 220, left: 40 }, animated: true },
      )
      return
    }
    const list = (pinsRef.current || []).filter((pin) => Number.isFinite(pin.latitude) && Number.isFinite(pin.longitude))
    if (list.length > 1) {
      mapRef.current.fitToCoordinates(
        list.map((pin) => ({ latitude: pin.latitude, longitude: pin.longitude })),
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
  }, [centerKey, pinKey, focusToken, heatKey, showHeat])

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
        customMapStyle={
          colorScheme === 'dark'
            ? [
                { elementType: 'geometry', stylers: [{ color: '#0e0b14' }] },
                { elementType: 'labels.text.fill', stylers: [{ color: '#f5f6f8' }] },
                { elementType: 'labels.text.stroke', stylers: [{ color: '#0e0b14' }] },
                { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2438' }] },
                { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#16121f' }] },
                { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#120e18' }] },
              ]
            : undefined
        }
        rotateEnabled={false}
        pitchEnabled={false}
        showsUserLocation={false}
      >
        {showHeat
          ? spots.map((spot) => (
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
        {markers.map((pin) => (
          <Marker
            key={pin.id}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            title={pin.title}
            pinColor={pin.pinColor || ORANGE}
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
  zone: { position: 'absolute', left: 16, top: 88, right: 16, alignItems: 'flex-start' },
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
