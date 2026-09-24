import { forwardRef, useImperativeHandle } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { heatColor } from 'rides-native/heat.js'
import { DOWNTOWN, STADIUM } from 'rides-native/places.js'
import { mapKindLabel, type CampusMapHandle, type CampusMapProps } from '@/components/mapTypes'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

export const CampusMap = forwardRef<CampusMapHandle, CampusMapProps>(function CampusMap(
  { spots, showHeat, mapType = 'standard', theater = false, gameDay = false, gameDayLabel = null, surge = false, userCoordinate = null, pins = [] },
  ref,
) {
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
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
          <View style={[styles.car, { backgroundColor: colors.orange }]} />
          <View style={[styles.car, { backgroundColor: colors.purple }]} />
          <Text style={styles.preview}>Preview cars</Text>
        </View>
      ) : null}
      <View style={styles.badges}>
        {gameDay ? <Text style={styles.badge}>{gameDayLabel || 'Game day'}</Text> : null}
        {surge ? <Text style={[styles.badge, styles.surge]}>Surge</Text> : null}
        {userCoordinate ? <Text style={styles.badge}>You</Text> : null}
      </View>
      <View style={styles.row}>
        <View style={[styles.pin, { backgroundColor: colors.purple }]}>
          <Text style={styles.pinText}>Campus</Text>
        </View>
        <View style={styles.line} />
        <View style={[styles.pin, { backgroundColor: colors.orange }]}>
          <Text style={styles.pinText}>GSP</Text>
        </View>
      </View>
      {pins.map((pin) => (
        <Text key={pin.id} style={styles.pinLabel}>{pin.title}</Text>
      ))}
      <Text style={styles.caption}>
        {DOWNTOWN.latitude.toFixed(3)}, {STADIUM.longitude.toFixed(3)}
      </Text>
    </View>
  )
})

function makeStyles(colors: Palette) {
  return {
    map: { flex: 1, backgroundColor: colors.mapFallback, alignItems: 'center' as const, justifyContent: 'center' as const },
    wash: { ...StyleSheet.absoluteFill, backgroundColor: colors.orangeSoft },
    kind: { position: 'absolute' as const, top: 12, left: 12, color: colors.link, fontWeight: '800' as const, fontSize: 11 },
    blob: { position: 'absolute' as const, borderRadius: 999 },
    theaterRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 8 },
    car: { width: 18, height: 12, borderRadius: 4 },
    preview: { color: colors.link, fontSize: 11, fontWeight: '700' as const },
    badges: { flexDirection: 'row' as const, gap: 6, marginBottom: 8 },
    badge: { backgroundColor: colors.purple, color: colors.onAccent, overflow: 'hidden' as const, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontWeight: '800' as const },
    surge: { backgroundColor: colors.orange },
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
    pin: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
    pinText: { color: colors.onAccent, fontWeight: '800' as const, fontSize: 12 },
    line: { width: 64, height: 3, borderRadius: 2, backgroundColor: colors.border },
    pinLabel: { marginTop: 4, color: colors.link, fontSize: 11, fontWeight: '700' as const },
    caption: { marginTop: 12, color: colors.link, fontWeight: '700' as const, fontSize: 12 },
  }
}
