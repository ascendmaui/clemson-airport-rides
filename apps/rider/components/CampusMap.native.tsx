import { StyleSheet, View } from 'react-native'
import MapView, { Circle, Marker, PROVIDER_DEFAULT } from 'react-native-maps'
import type { BusySpot } from '@/lib/busySpots'
import { heatColor } from 'rides-native/heat.js'
import { DOWNTOWN, ORANGE, PURPLE, STADIUM } from 'rides-native/places.js'

function rgba(hex: string, alpha: number) {
  const raw = hex.replace('#', '')
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export function CampusMap({
  spots,
  showHeat,
}: {
  spots: BusySpot[]
  showHeat: boolean
}) {
  const center = showHeat ? DOWNTOWN : STADIUM
  return (
    <View style={styles.fill}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: center.latitude,
          longitude: center.longitude,
          latitudeDelta: showHeat ? 0.028 : 0.035,
          longitudeDelta: showHeat ? 0.028 : 0.035,
        }}
        mapType="standard"
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
      >
        <Marker coordinate={STADIUM} pinColor={ORANGE} title="Memorial Stadium" />
        <Marker coordinate={DOWNTOWN} pinColor={PURPLE} title="Downtown Clemson" />
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
      </MapView>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
