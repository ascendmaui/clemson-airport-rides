import { StyleSheet, Text, View } from 'react-native'
import { PURPLE } from 'rides-native/places.js'

export type MapPin = {
  id: string
  latitude: number
  longitude: number
  title: string
  pinColor?: string
}

export function CampusMap({
  center,
}: {
  pins?: MapPin[]
  center?: { latitude: number; longitude: number } | null
  route?: { latitude: number; longitude: number }[]
}) {
  return (
    <View style={styles.map}>
      <Text style={styles.label}>Clemson campus</Text>
      <Text style={styles.sub}>
        {center ? `${center.latitude.toFixed(3)}, ${center.longitude.toFixed(3)}` : 'Driver map · Apple Maps on device'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  map: { flex: 1, backgroundColor: '#E4D7F2', alignItems: 'center', justifyContent: 'center' },
  label: { color: PURPLE, fontWeight: '800', fontSize: 18 },
  sub: { color: PURPLE, marginTop: 6, fontSize: 12 },
})
