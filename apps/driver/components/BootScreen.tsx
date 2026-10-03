import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { ORANGE, PURPLE } from 'rides-native/places.js'

export function BootScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.mark}>
        <Text style={styles.markLabel}>CD</Text>
      </View>
      <Text style={styles.title}>Clemson RIDES Driver</Text>
      <ActivityIndicator color={ORANGE} style={styles.spinner} />
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
    shadowColor: '#1A1033',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  markLabel: { color: '#fff', fontWeight: '800', fontSize: 20 },
  title: { color: '#fff', fontWeight: '800', fontSize: 22, letterSpacing: -0.3 },
  spinner: { marginTop: 18 },
})
