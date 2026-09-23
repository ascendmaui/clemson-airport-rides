import { StyleSheet, View } from 'react-native'
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps'
import { DOWNTOWN, ORANGE, PURPLE, STADIUM } from 'rides-native/places.js'

export function CampusMap() {
  return (
    <View style={styles.fill}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: DOWNTOWN.latitude,
          longitude: DOWNTOWN.longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        }}
        mapType="standard"
        rotateEnabled={false}
        pitchEnabled={false}
      >
        <Marker coordinate={STADIUM} pinColor={ORANGE} title="Memorial Stadium" />
        <Marker coordinate={DOWNTOWN} pinColor={PURPLE} title="Downtown Clemson" />
      </MapView>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
