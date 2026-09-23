import { StyleSheet, Text, View } from 'react-native'
import type { BusySpot } from '@/lib/busySpots'
import { DOWNTOWN, STADIUM } from 'rides-native/places.js'
import { heatColor } from 'rides-native/heat.js'

export function CampusMap({
  spots,
  showHeat,
}: {
  spots: BusySpot[]
  showHeat: boolean
}) {
  return (
    <View style={styles.map}>
      <View style={styles.wash} />
      {showHeat
        ? spots.slice(0, 8).map((spot, index) => (
            <View
              key={spot.id}
              style={[
                styles.blob,
                {
                  backgroundColor: heatColor(spot.intensity),
                  opacity: 0.28 + spot.intensity * 0.35,
                  width: 36 + spot.intensity * 48,
                  height: 36 + spot.intensity * 48,
                  left: 24 + (index % 4) * 70,
                  top: 36 + (index % 3) * 54,
                },
              ]}
            />
          ))
        : null}
      <View style={styles.row}>
        <View style={[styles.pin, { backgroundColor: '#522D80' }]}>
          <Text style={styles.pinText}>Campus</Text>
        </View>
        <View style={styles.line} />
        <View style={[styles.pin, { backgroundColor: '#F56600' }]}>
          <Text style={styles.pinText}>GSP</Text>
        </View>
      </View>
      <Text style={styles.caption}>
        {DOWNTOWN.latitude.toFixed(3)}, {STADIUM.longitude.toFixed(3)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  map: { flex: 1, backgroundColor: '#E7D7EA', alignItems: 'center', justifyContent: 'center' },
  wash: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(245,102,0,0.12)' },
  blob: { position: 'absolute', borderRadius: 999 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pin: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  pinText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  line: { width: 64, height: 3, borderRadius: 2, backgroundColor: 'rgba(82,45,128,0.45)' },
  caption: { marginTop: 12, color: '#522D80', fontWeight: '700', fontSize: 12 },
})
