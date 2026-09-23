import { StyleSheet, Text, View } from 'react-native'
import { ORANGE, PURPLE } from 'rides-native/places.js'

export function BootScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.mark}>
        <Text style={styles.markLabel}>CD</Text>
      </View>
      <Text style={styles.title}>Clemson RIDES Driver</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  mark: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  markLabel: { color: '#fff', fontWeight: '800', fontSize: 20 },
  title: { color: '#fff', fontWeight: '800', fontSize: 22 },
})
