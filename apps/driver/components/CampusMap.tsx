import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { heatColor } from 'rides-native/heat.js'
import { useTheme } from '@/lib/theme'
import type { BusySpot } from '@/lib/busySpots'
import { fetchTigerHeatMap } from 'rides-native/tigerHeatClient.js'
import type { TigerHeatZone } from 'rides-native/tigerHeat.js'

export type MapPin = {
  id: string
  latitude: number
  longitude: number
  title: string
  pinColor?: string
  kind?: 'self' | 'request' | 'place'
}

export function CampusMap({
  pins,
  center,
  colorScheme,
  spots = [],
  showHeat = false,
  heatWindow = 'now',
  gameDay = false,
  gameDayLabel = null,
  lockOnCenter = false,
  onPinPress,
  showsUserLocation = false,
}: {
  pins?: MapPin[]
  center?: { latitude: number; longitude: number } | null
  route?: { latitude: number; longitude: number }[]
  colorScheme?: 'light' | 'dark'
  focusToken?: number
  spots?: BusySpot[]
  showHeat?: boolean
  heatWindow?: string
  gameDay?: boolean
  gameDayLabel?: string | null
  lockOnCenter?: boolean
  onPinPress?: (id: string) => void
  showsUserLocation?: boolean
}) {
  const { colors, scheme } = useTheme()
  const mode = colorScheme || scheme
  const [tigerZones, setTigerZones] = useState<TigerHeatZone[]>([])
  useEffect(() => {
    if (!showHeat) {
      setTigerZones([])
      return undefined
    }
    let alive = true
    fetchTigerHeatMap(heatWindow).then((result) => {
      if (alive) setTigerZones(result.zones || [])
    }).catch(() => {
      if (alive) setTigerZones([])
    })
    return () => {
      alive = false
    }
  }, [showHeat, heatWindow])
  return (
    <View style={[styles.map, { backgroundColor: mode === 'dark' ? colors.mapFallback : '#E4D7F2' }]}>
      {showHeat
        ? spots.slice(0, 8).map((spot: BusySpot, index: number) => (
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
      {showHeat && tigerZones.length ? (
        <View style={styles.tigerRow}>
          {tigerZones.map((zone: TigerHeatZone) => (
            <Text
              key={zone.id}
              style={[styles.tigerChip, zone.preview ? styles.tigerPreview : styles.tigerLive]}
            >
              {zone.bonusLabel}
            </Text>
          ))}
        </View>
      ) : null}
      {gameDay ? (
        <Text style={[styles.zone, { backgroundColor: colors.orange, color: colors.onAccent }]}>
          {gameDayLabel || 'Game day'}
        </Text>
      ) : null}
      <Text style={[styles.label, { color: colors.title }]}>Clemson campus</Text>
      <Text style={[styles.sub, { color: colors.title }]}>
        {lockOnCenter && center
          ? `Centered on you · ${center.latitude.toFixed(3)}, ${center.longitude.toFixed(3)}`
          : showHeat
            ? `Busy areas · ${spots.length} spots`
            : showsUserLocation
              ? 'Detecting your location'
              : center
                ? `${center.latitude.toFixed(3)}, ${center.longitude.toFixed(3)}`
                : 'Driver map'}
      </Text>
      {(pins || []).map((pin: MapPin) => (
        <Pressable
          key={pin.id}
          onPress={() => onPinPress?.(pin.id)}
          accessibilityRole="button"
          accessibilityLabel={pin.kind === 'request' ? `Ride request at ${pin.title}` : pin.title}
        >
          <Text style={[styles.pin, pin.kind === 'request' ? styles.requestPin : null, { color: pin.pinColor || colors.title }]}>
            {pin.kind === 'request' ? '● ' : ''}{pin.title}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  map: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  label: { fontWeight: '800', fontSize: 18, zIndex: 1 },
  sub: { marginTop: 6, fontSize: 12, zIndex: 1 },
  pin: { marginTop: 4, fontSize: 11, fontWeight: '700', zIndex: 1 },
  requestPin: { fontSize: 13 },
  tigerRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, zIndex: 2, marginBottom: 8 },
  tigerChip: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: '800', color: '#fff' },
  tigerLive: { backgroundColor: '#F56600', borderWidth: 2, borderColor: '#522D80' },
  tigerPreview: { backgroundColor: '#522D80', borderWidth: 2, borderColor: '#F56600' },
  zone: {
    position: 'absolute',
    top: 16,
    left: 16,
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '800',
    zIndex: 2,
  },
  blob: { position: 'absolute', borderRadius: 999 },
})
