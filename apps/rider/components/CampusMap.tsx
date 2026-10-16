import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import { DOWNTOWN, STADIUM } from 'rides-native/places.js'
import { SIMULATED_FLEET_BADGE, refuseSimulatedDriverTap, simulatedFleetPercent } from 'rides-native/simulatedDrivers.js'
import { demoCarPaint, SEARCH_MAP_DELTA_END, SEARCH_MAP_DELTA_START, SEARCH_MAP_ZOOM_MS } from 'rides-native/searchPreview.js'
import { useSimulatedFleet } from 'rides-native/useSimulatedFleet.js'
import { mapKindLabel, type CampusMapHandle, type CampusMapProps, type MapPin } from '@/components/mapTypes'
import { searchTheaterColors, type Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

export const CampusMap = forwardRef<CampusMapHandle, CampusMapProps>(function CampusMap(
  { spots, showHeat, heatWindow = 'now', mapType = 'standard', theater = false, searchMotion = false, gameDay = false, gameDayLabel = null, surge = false, userCoordinate = null, pins = [], showSimulatedFleet = false, showFleetBadge = true },
  ref: any,
) {
  const { colors, scheme } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const simulatedFleet = useSimulatedFleet(showSimulatedFleet || searchMotion)
  const zoom = useRef(new Animated.Value(1)).current
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
      {theater ? (
        <View style={styles.theaterRow}>
          <View style={[styles.car, { backgroundColor: colors.orange }]} />
          <View style={[styles.car, { backgroundColor: colors.purple }]} />
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1} style={styles.preview}>Preview cars</Text>
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
      {showSimulatedFleet && showFleetBadge ? (
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1} style={styles.busyNote}>{SIMULATED_FLEET_BADGE}</Text>
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
    searchStage: { ...StyleSheet.absoluteFill, backgroundColor: searchTheaterColors.stage },
    searchField: { ...StyleSheet.absoluteFill, backgroundColor: searchTheaterColors.field },
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
      borderColor: colors.onAccent,
    },
    wash: { ...StyleSheet.absoluteFill, backgroundColor: colors.orangeSoft },
    kind: { position: 'absolute' as const, top: 12, left: 12, color: colors.link, fontWeight: '800' as const, fontSize: 12 },
    theaterRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 8 },
    car: { width: 18, height: 12, borderRadius: 4 },
    preview: { color: colors.link, fontSize: 12, fontWeight: '700' as const },
    badges: { flexDirection: 'row' as const, gap: 6, marginBottom: 8 },
    badge: { backgroundColor: colors.purple, color: colors.onAccent, overflow: 'hidden' as const, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 12, fontWeight: '800' as const },
    surge: { backgroundColor: colors.orange },
    tigerLive: { backgroundColor: colors.orange, borderWidth: 2, borderColor: colors.purple },
    tigerPreview: { backgroundColor: colors.purple, borderWidth: 2, borderColor: colors.orange },
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
    pin: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
    pinText: { color: colors.onAccent, fontWeight: '800' as const, fontSize: 12 },
    line: { width: 64, height: 3, borderRadius: 2, backgroundColor: colors.border },
    pinLabel: { marginTop: 4, color: colors.link, fontSize: 12, fontWeight: '700' as const },
    busyCar: {
      position: 'absolute' as const,
      minWidth: 44,
      minHeight: 44,
      marginLeft: -22,
      marginTop: -22,
      borderRadius: 22,
      backgroundColor: colors.purple,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingHorizontal: 8,
    },
    busyCarDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.onAccent },
    busyNote: {
      position: 'absolute' as const,
      right: 12,
      bottom: 12,
      overflow: 'hidden' as const,
      borderRadius: 999,
      backgroundColor: colors.purple,
      color: colors.onAccent,
      fontSize: 12,
      fontWeight: '800' as const,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    caption: { marginTop: 12, color: colors.link, fontWeight: '700' as const, fontSize: 12 },
  }
}
