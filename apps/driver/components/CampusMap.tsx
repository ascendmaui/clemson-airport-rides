import { StyleSheet, Text, View } from 'react-native'
import { heatColor } from 'rides-native/heat.js'
import { useTheme } from '@/lib/theme'
import type { BusySpot } from '@/lib/busySpots'

export type MapPin = {
  id: string
  latitude: number
  longitude: number
  title: string
  pinColor?: string
}

export function CampusMap({
  pins,
  center,
  colorScheme,
  spots = [],
  showHeat = false,
}: {
  pins?: MapPin[]
  center?: { latitude: number; longitude: number } | null
  route?: { latitude: number; longitude: number }[]
  colorScheme?: 'light' | 'dark'
  focusToken?: number
  spots?: BusySpot[]
  showHeat?: boolean
}) {
  const { colors, scheme } = useTheme()
  const mode = colorScheme || scheme
  return (
    <View style={[styles.map, { backgroundColor: mode === 'dark' ? colors.mapFallback : '#E4D7F2' }]}>
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
      <Text style={[styles.label, { color: colors.title }]}>Clemson campus</Text>
      <Text style={[styles.sub, { color: colors.title }]}>
        {showHeat
          ? `Busy areas · ${spots.length} spots`
          : center
            ? `${center.latitude.toFixed(3)}, ${center.longitude.toFixed(3)}`
            : 'Driver map'}
      </Text>
      {(pins || []).slice(0, 3).map((pin) => (
        <Text key={pin.id} style={[styles.pin, { color: colors.title }]}>
          {pin.title}
        </Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  map: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  label: { fontWeight: '800', fontSize: 18, zIndex: 1 },
  sub: { marginTop: 6, fontSize: 12, zIndex: 1 },
  pin: { marginTop: 4, fontSize: 11, fontWeight: '700', zIndex: 1 },
  blob: { position: 'absolute', borderRadius: 999 },
})
