import { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps'
import { DOWNTOWN, ORANGE, PURPLE, STADIUM } from 'rides-native/places.js'
import type { MapPin } from './CampusMap'

export function CampusMap({
  pins,
  center,
  route,
}: {
  pins?: MapPin[]
  center?: { latitude: number; longitude: number } | null
  route?: { latitude: number; longitude: number }[]
}) {
  const mapRef = useRef<MapView>(null)
  const markers = pins?.length
    ? pins
    : [
        { id: 'stadium', latitude: STADIUM.latitude, longitude: STADIUM.longitude, title: 'Memorial Stadium', pinColor: ORANGE },
        { id: 'downtown', latitude: DOWNTOWN.latitude, longitude: DOWNTOWN.longitude, title: 'Downtown Clemson', pinColor: PURPLE },
      ]
  const focus = center || markers[0]

  useEffect(() => {
    if (!center || !mapRef.current) return
    mapRef.current.animateToRegion(
      {
        latitude: center.latitude,
        longitude: center.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      },
      450,
    )
  }, [center])

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
