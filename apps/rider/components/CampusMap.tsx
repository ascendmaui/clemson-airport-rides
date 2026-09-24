import { forwardRef, useImperativeHandle } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { heatColor } from 'rides-native/heat.js'
import { DOWNTOWN, STADIUM } from 'rides-native/places.js'
import { mapKindLabel, type CampusMapHandle, type CampusMapProps } from '@/components/mapTypes'

export const CampusMap = forwardRef<CampusMapHandle, CampusMapProps>(function CampusMap(
  { spots, showHeat, mapType = 'standard', theater = false, gameDay = false, surge = false, userCoordinate = null, pins = [] },
  ref,
) {
  useImperativeHandle(ref, () => ({
    animateTo() {},
  }))

  return (
    <View style={styles.map}>
      <View style={styles.wash} />
      <Text style={styles.kind}>{mapKindLabel(mapType)}</Text>
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
                  top: 48 + (index % 3) * 54,
                },
              ]}
            />
          ))
        : null}
      {theater ? (
        <View style={styles.theaterRow}>
          <View style={[styles.car, { backgroundColor: '#F56600' }]} />
          <View style={[styles.car, { backgroundColor: '#522D80' }]} />
          <Text style={styles.preview}>Preview cars</Text>
        </View>
      ) : null}
      <View style={styles.badges}>
        {gameDay ? <Text style={styles.badge}>Game day</Text> : null}
        {surge ? <Text style={[styles.badge, styles.surge]}>Surge</Text> : null}
        {userCoordinate ? <Text style={styles.badge}>You</Text> : null}
      </View>
      <View style={styles.row}>
        <View style={[styles.pin, { backgroundColor: '#522D80' }]}>
          <Text style={styles.pinText}>Campus</Text>
        </View>
        <View style={styles.line} />
        <View style={[styles.pin, { backgroundColor: '#F56600' }]}>
          <Text style={styles.pinText}>GSP</Text>
        </View>
      </View>
      {pins.slice(0, 3).map((pin) => (
        <Text key={pin.id} style={styles.pinLabel}>{pin.title}</Text>
      ))}
      <Text style={styles.caption}>
        {DOWNTOWN.latitude.toFixed(3)}, {STADIUM.longitude.toFixed(3)}
      </Text>
    </View>
  )
})

const styles = StyleSheet.create({
  map: { flex: 1, backgroundColor: '#E7D7EA', alignItems: 'center', justifyContent: 'center' },
  wash: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(245,102,0,0.12)' },
  kind: { position: 'absolute', top: 12, left: 12, color: '#522D80', fontWeight: '800', fontSize: 11 },
  blob: { position: 'absolute', borderRadius: 999 },
  theaterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  car: { width: 18, height: 12, borderRadius: 4 },
  preview: { color: '#522D80', fontSize: 11, fontWeight: '700' },
  badges: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  badge: { backgroundColor: '#522D80', color: '#fff', overflow: 'hidden', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontWeight: '800' },
  surge: { backgroundColor: '#F56600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pin: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  pinText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  line: { width: 64, height: 3, borderRadius: 2, backgroundColor: 'rgba(82,45,128,0.45)' },
  pinLabel: { marginTop: 4, color: '#522D80', fontSize: 11, fontWeight: '700' },
  caption: { marginTop: 12, color: '#522D80', fontWeight: '700', fontSize: 12 },
})
