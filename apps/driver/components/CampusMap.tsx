import { StyleSheet, Text, View } from 'react-native'
import { PURPLE } from 'rides-native/places.js'

export function CampusMap() {
  return (
    <View style={styles.map}>
      <Text style={styles.label}>Clemson campus</Text>
      <Text style={styles.sub}>Driver map · Apple Maps on device</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  map: { flex: 1, backgroundColor: '#E4D7F2', alignItems: 'center', justifyContent: 'center' },
  label: { color: PURPLE, fontWeight: '800', fontSize: 18 },
  sub: { color: PURPLE, marginTop: 6, fontSize: 12 },
})
