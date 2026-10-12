import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import { heatColor } from 'rides-native/heat.js'
import { DOWNTOWN, STADIUM } from 'rides-native/places.js'
import { SIMULATED_FLEET_BADGE, refuseSimulatedDriverTap, simulatedFleetPercent } from 'rides-native/simulatedDrivers.js'
import { demoCarPaint, SEARCH_MAP_DELTA_END, SEARCH_MAP_DELTA_START, SEARCH_MAP_ZOOM_MS } from 'rides-native/searchPreview.js'
import { useSimulatedFleet } from 'rides-native/useSimulatedFleet.js'
import { fetchTigerHeatMap } from 'rides-native/tigerHeatClient.js'
import type { TigerHeatZone } from 'rides-native/tigerHeat.js'
import { mapKindLabel, type CampusMapHandle, type CampusMapProps, type MapPin } from '@/components/mapTypes'
import type { BusySpot } from '@/lib/busySpots'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

export const CampusMap = forwardRef<CampusMapHandle, CampusMapProps>(function CampusMap(
  { spots, showHeat, heatWindow = 'now', mapType = 'standard', theater = false, searchMotion = false, gameDay = false, gameDayLabel = null, surge = false, userCoordinate = null, pins = [], showSimulatedFleet = false },
  ref: any,
) {
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const simulatedFleet = useSimulatedFleet(showSimulatedFleet || searchMotion)
  const zoom = useRef(new Animated.Value(1)).current
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
  useImperativeHandle(ref, () => ({
    animateTo() {},
  }))

  useEffect(() => {
    if (!searchMotion) {
      zoom.setValue(1)
      return undefined
    }
    zoom.setValue(SEARCH_MAP_DELTA_END / SEARCH_MAP_DELTA_START)
    const anim = Animated.timing(zoom, {
      toValue: 1,
      duration: SEARCH_MAP_ZOOM_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [searchMotion, zoom])

  return (
    <View style={styles.map}>
      {searchMotion ? (
        <Animated.View pointerEvents="none" style={[styles.searchStage, { transform: [{ scale: zoom }] }]}>
          <View style={styles.searchField} />
          {simulatedFleet.map((car) => {
            const spot = simulatedFleetPercent(car.lat, car.lng)
            const paint = demoCarPaint(car)
            const wedge = car.body === 'wedge'
            const who = car.firstName || car.title || 'Driver'
            const vehicle = car.label || car.routeLabel
            return (
              <View
                key={car.id}
                accessibilityLabel={`${who}, ${vehicle}`}
                style={[
                  styles.searchCar,
                  {
                    left: `${spot.left}%`,
                    top: `${spot.top}%`,
                    width: wedge ? 22 : 14,
                    height: wedge ? 16 : 22,
                    borderRadius: wedge ? 2 : 5,
                    backgroundColor: paint.fill,
                    borderColor: paint.edge,
                    transform: [{ rotate: `${car.heading}deg` }],
                  },
                ]}
              />
            )
          })}
          {pins.map((pin: MapPin) => {
            const spot = simulatedFleetPercent(pin.latitude, pin.longitude)
            return (
              <View
                key={pin.id}
                style={[styles.searchPin, { left: `${spot.left}%`, top: `${spot.top}%`, backgroundColor: pin.color }]}
              />
            )
          })}
        </Animated.View>
      ) : null}
      {searchMotion ? null : (
      <>
      <View style={styles.wash} />
      <Text style={styles.kind}>{mapKindLabel(mapType)}</Text>
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
      {theater ? (
        <View style={styles.theaterRow}>
          <View style={[styles.car, { backgroundColor: colors.orange }]} />
          <View style={[styles.car, { backgroundColor: colors.purple }]} />
          <Text style={styles.preview}>Preview cars</Text>
        </View>
      ) : null}
      <View style={styles.badges}>
        {showHeat
          ? tigerZones.map((zone: TigerHeatZone) => (
              <Text
                key={zone.id}
                style={[styles.badge, zone.preview ? styles.tigerPreview : styles.tigerLive]}
              >
                {zone.bonusLabel}
              </Text>
            ))
          : null}
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
      {pins.map((pin: MapPin) => (
        <Text key={pin.id} style={styles.pinLabel}>{pin.title}</Text>
      ))}
      {showSimulatedFleet
        ? simulatedFleet.map((car) => {
            const spot = simulatedFleetPercent(car.lat, car.lng)
            return (
              <Pressable
                key={car.id}
                accessibilityRole="image"
                accessibilityLabel={car.description}
                onPress={() => {
                  refuseSimulatedDriverTap(car.id)
                }}
                style={[styles.busyCar, { left: `${spot.left}%`, top: `${spot.top}%` }]}
              >
                <View style={styles.busyCarDot} />
              </Pressable>
            )
          })
        : null}
      {showSimulatedFleet ? (
        <Text style={styles.busyNote}>{SIMULATED_FLEET_BADGE}</Text>
      ) : null}
      <Text style={styles.caption}>
        {DOWNTOWN.latitude.toFixed(3)}, {STADIUM.longitude.toFixed(3)}
      </Text>
      </>
      )}
    </View>
  )
})

function makeStyles(colors: Palette) {
  return {
    map: { flex: 1, position: 'relative' as const, overflow: 'hidden' as const, backgroundColor: colors.mapFallback, alignItems: 'center' as const, justifyContent: 'center' as const },
    searchStage: { ...StyleSheet.absoluteFillObject, backgroundColor: '#1B2836' },
    searchField: { ...StyleSheet.absoluteFillObject, backgroundColor: '#243447' },
    searchCar: {
      position: 'absolute' as const,
      marginLeft: -7,
      marginTop: -11,
      borderWidth: 2,
    },
    searchPin: {
      position: 'absolute' as const,
      width: 12,
      height: 12,
      marginLeft: -6,
      marginTop: -6,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: '#FFFFFF',
    },
    wash: { ...StyleSheet.absoluteFill, backgroundColor: colors.orangeSoft },
    kind: { position: 'absolute' as const, top: 12, left: 12, color: colors.link, fontWeight: '800' as const, fontSize: 11 },
    blob: { position: 'absolute' as const, borderRadius: 999 },
    theaterRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 8 },
    car: { width: 18, height: 12, borderRadius: 4 },
    preview: { color: colors.link, fontSize: 11, fontWeight: '700' as const },
    badges: { flexDirection: 'row' as const, gap: 6, marginBottom: 8 },
    badge: { backgroundColor: colors.purple, color: colors.onAccent, overflow: 'hidden' as const, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontWeight: '800' as const },
    surge: { backgroundColor: colors.orange },
    tigerLive: { backgroundColor: '#F56600', borderWidth: 2, borderColor: '#522D80' },
    tigerPreview: { backgroundColor: '#522D80', borderWidth: 2, borderColor: '#F56600' },
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
    pin: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
    pinText: { color: colors.onAccent, fontWeight: '800' as const, fontSize: 12 },
    line: { width: 64, height: 3, borderRadius: 2, backgroundColor: colors.border },
    pinLabel: { marginTop: 4, color: colors.link, fontSize: 11, fontWeight: '700' as const },
    busyCar: {
      position: 'absolute' as const,
      minWidth: 44,
      minHeight: 44,
      marginLeft: -22,
      marginTop: -22,
      borderRadius: 22,
      backgroundColor: '#522D80',
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingHorizontal: 8,
    },
    busyCarDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFFFFF' },
    busyNote: {
      position: 'absolute' as const,
      right: 12,
      bottom: 12,
      overflow: 'hidden' as const,
      borderRadius: 999,
      backgroundColor: '#522D80',
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '800' as const,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    caption: { marginTop: 12, color: colors.link, fontWeight: '700' as const, fontSize: 12 },
  }
}
