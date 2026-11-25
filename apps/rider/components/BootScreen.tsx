import { StyleSheet, Text, View } from 'react-native'
import { ORANGE, PURPLE } from 'rides-native/places.js'
import { color } from 'rides-native/shared/theme.js'

export function BootScreen({ mark = 'CR' }: { mark?: string }) {
  return (
    <View style={styles.screen}>
      <View style={styles.mark}>
        <Text style={styles.markLabel}>{mark}</Text>
      </View>
      <Text style={styles.title}>Clemson Rides</Text>
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
  markLabel: { color: color.white, fontWeight: '800', fontSize: 20 },
  title: { color: color.white, fontWeight: '800', fontSize: 22, letterSpacing: -0.3 },
})
