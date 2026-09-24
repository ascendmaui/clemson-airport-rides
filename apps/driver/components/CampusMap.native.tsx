import { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps'
import { DOWNTOWN, ORANGE, PURPLE, STADIUM } from 'rides-native/places.js'
import type { MapPin } from './CampusMap'

const DARK_MAP = [
  { elementType: 'geometry', stylers: [{ color: '#0e0b14' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#f5f6f8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0e0b14' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2438' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#16121f' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#120e18' }] },
]

export function CampusMap({
  pins,
  center,
  route,
  colorScheme = 'light',
  focusToken = 0,
}: {
  pins?: MapPin[]
  center?: { latitude: number; longitude: number } | null
  route?: { latitude: number; longitude: number }[]
  colorScheme?: 'light' | 'dark'
  focusToken?: number
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

  useEffect(() => {
    if (!mapRef.current) return
    const spots = (pinsRef.current || []).filter((pin) => Number.isFinite(pin.latitude) && Number.isFinite(pin.longitude))
    if (spots.length > 1) {
      mapRef.current.fitToCoordinates(
        spots.map((pin) => ({ latitude: pin.latitude, longitude: pin.longitude })),
        { edgePadding: { top: 80, right: 40, bottom: 220, left: 40 }, animated: true },
      )
      return
    }
    const focus = centerRef.current
    if (!focus) return
    mapRef.current.animateToRegion(
      {
        latitude: focus.latitude,
        longitude: focus.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      },
      450,
    )
  }, [centerKey, pinKey, focusToken])

  return (
    <View style={styles.fill}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: focus.latitude,
          longitude: focus.longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        }}
        mapType="standard"
        userInterfaceStyle={colorScheme}
        customMapStyle={colorScheme === 'dark' ? DARK_MAP : undefined}
        rotateEnabled={false}
        pitchEnabled={false}
        showsUserLocation={false}
      >
        {route && route.length > 1 ? (
          <Polyline coordinates={route} strokeColor={ORANGE} strokeWidth={4} />
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
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
