import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import Constants from 'expo-constants'
import MapView, { Circle, Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps'
import { ANDROID_MAP_UNAVAILABLE, googleMapStyle, nativeMapTilesReady } from 'rides-native/googleMapChrome.js'
import { heatColor } from 'rides-native/heat.js'
import { DOWNTOWN, STADIUM } from 'rides-native/places.js'
import { SIMULATED_FLEET_BADGE, refuseSimulatedDriverTap } from 'rides-native/simulatedDrivers.js'
import { demoCarPaint, SEARCH_MAP_ZOOM_MS, searchMapRegion } from 'rides-native/searchPreview.js'
import { useSimulatedFleet } from 'rides-native/useSimulatedFleet.js'
import type { CampusMapHandle, CampusMapProps } from '@/components/mapTypes'
import { useTheme } from '@/lib/theme'

function rgba(hex: string, alpha: number) {
  const raw = hex.replace('#', '')
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function SearchFleetGlyph({
  heading,
  livery,
  body,
  label,
}: {
  heading: number
  livery?: string
  body?: string
  label: string
}) {
  const paint = demoCarPaint({ livery })
  const wedge = body === 'wedge'
  return (
    <View
      accessibilityLabel={label}
      style={{
        width: wedge ? 22 : 14,
        height: wedge ? 16 : 22,
        borderRadius: wedge ? 2 : 5,
        backgroundColor: paint.fill,
        borderColor: paint.edge,
        borderWidth: 2,
        transform: [{ rotate: `${heading}deg` }],
      }}
    />
  )
}

function theaterCar(index: number, tick: number, orange: string, purple: string) {
  const angle = tick * 0.45 + index * (Math.PI / 2)
  const radius = 0.0034 + (index % 2) * 0.0015
  return {
    latitude: STADIUM.latitude + Math.sin(angle) * radius,
    longitude: STADIUM.longitude + Math.cos(angle) * radius * 1.2,
    color: index % 2 === 0 ? orange : purple,
  }
}

export const CampusMap = forwardRef<CampusMapHandle, CampusMapProps>(function CampusMap(
  {
    spots,
    showHeat,
    mapType = 'standard',
    theater = false,
    searchMotion = false,
    gameDay = false,
    gameDayLabel = null,
    surge = false,
    userCoordinate = null,
    pins = [],
    fitPins = false,
    showSimulatedFleet = false,
    route = [],
  },
  ref: any,
) {
  const { colors, scheme } = useTheme()
  const mapRef = useRef<MapView>(null)
  const simulatedFleet = useSimulatedFleet(showSimulatedFleet || searchMotion)
  const opened = searchMapRegion(0)
  const [tick, setTick] = useState(0)
  const [radar, setRadar] = useState(90)
  const center = showHeat ? DOWNTOWN : STADIUM

  useImperativeHandle(ref, () => ({
    animateTo(coord: LatLng, delta = 0.018) {
      mapRef.current?.animateToRegion(
        {
          latitude: coord.latitude,
          longitude: coord.longitude,
          latitudeDelta: delta,
          longitudeDelta: delta,
        },
        700,
      )
    },
  }))

  const fitKey = pins
    .map((pin) => `${pin.id}:${pin.badge || ''}:${pin.id === 'driver' ? 'd' : pin.latitude.toFixed(5)}:${pin.id === 'driver' ? '' : pin.longitude.toFixed(5)}`)
    .join('|')

  useEffect(() => {
    if (searchMotion || !fitPins || !pins.length || !mapRef.current) return undefined
    const coords = pins.map((pin) => ({ latitude: pin.latitude, longitude: pin.longitude }))
    if (coords.length === 1) {
      mapRef.current.animateToRegion({
        latitude: coords[0].latitude,
        longitude: coords[0].longitude,
        latitudeDelta: 0.04,
        longitudeDelta: 0.04,
      }, 500)
      return undefined
    }
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 48, right: 48, bottom: 48, left: 48 },
      animated: true,
    })
    return undefined
  }, [searchMotion, fitPins, fitKey])

  useEffect(() => {
    if (!searchMotion) return undefined
    let cancelled = false
    let attempts = 0
    let widen: ReturnType<typeof setTimeout> | undefined
    const start = searchMapRegion(0)
    const end = searchMapRegion(SEARCH_MAP_ZOOM_MS)
    const frame = (region: ReturnType<typeof searchMapRegion>, duration: number) => {
      mapRef.current?.animateToRegion(
        {
          latitude: region.latitude,
          longitude: region.longitude,
          latitudeDelta: region.latitudeDelta,
          longitudeDelta: region.longitudeDelta,
        },
        duration,
      )
    }
    const wait = setInterval(() => {
      if (cancelled) return
      attempts += 1
      if (!mapRef.current) {
        if (attempts > 40) clearInterval(wait)
        return
      }
      clearInterval(wait)
      frame(start, 40)
      widen = setTimeout(() => {
        if (!cancelled) frame(end, SEARCH_MAP_ZOOM_MS)
      }, 120)
    }, 50)
    return () => {
      cancelled = true
      clearInterval(wait)
      if (widen) clearTimeout(widen)
    }
  }, [searchMotion])

  useEffect(() => {
    if (!theater || searchMotion) return undefined
    const id = setInterval(() => {
      setTick((value: number) => value + 1)
      setRadar((value: number) => (value > 320 ? 80 : value + 36))
    }, 700)
    return () => clearInterval(id)
  }, [theater, searchMotion])

  const tilesReady = nativeMapTilesReady(Platform.OS, {
    env: typeof process !== 'undefined' ? process.env : {},
    manifestKey: Constants.expoConfig?.android?.config?.googleMaps?.apiKey,
  })
  if (!tilesReady) {
    return (
      <View style={[styles.fill, styles.unavailable]}>
        <Text style={styles.unavailableTitle}>Map unavailable</Text>
        <Text style={styles.unavailableBody}>{ANDROID_MAP_UNAVAILABLE}</Text>
      </View>
    )
  }

  return (
    <View style={styles.fill}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={searchMotion ? {
          latitude: opened.latitude,
          longitude: opened.longitude,
          latitudeDelta: opened.latitudeDelta,
          longitudeDelta: opened.longitudeDelta,
        } : {
          latitude: center.latitude,
          longitude: center.longitude,
          latitudeDelta: showHeat ? 0.028 : 0.04,
          longitudeDelta: showHeat ? 0.028 : 0.04,
        }}
        mapType={mapType}
        userInterfaceStyle={scheme}
        customMapStyle={googleMapStyle(scheme)}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsUserLocation={false}
      >
        <Marker coordinate={STADIUM} pinColor={colors.orange} title="Memorial Stadium" />
        <Marker coordinate={DOWNTOWN} pinColor={colors.purple} title="Downtown Clemson" />
        {showHeat
          ? spots.map((spot: BusySpot) => (
              <Circle
                key={spot.id}
                center={{ latitude: spot.lat, longitude: spot.lng }}
                radius={spot.radius}
                fillColor={rgba(heatColor(spot.intensity), 0.28)}
                strokeColor={heatColor(spot.intensity)}
                strokeWidth={1}
              />
            ))
          : null}
        {gameDay ? (
          <Circle
            center={STADIUM}
            radius={420}
            fillColor={colors.orangeSoft}
            strokeColor={colors.orange}
            strokeWidth={2}
          />
        ) : null}
        {surge ? (
          <Circle
            center={DOWNTOWN}
            radius={260}
            fillColor={colors.purpleSoft}
            strokeColor={colors.purple}
            strokeWidth={2}
          />
        ) : null}
        {theater && !searchMotion ? (
          <Circle
            center={STADIUM}
            radius={radar}
            fillColor={colors.orangeSoft}
            strokeColor={tick % 2 === 0 ? colors.orange : colors.purple}
            strokeWidth={2}
          />
        ) : null}
        {theater && !searchMotion
          ? [0, 1, 2, 3].map((index) => {
              const car = theaterCar(index, tick, colors.orange, colors.purple)
              return (
                <Marker
                  key={`preview-${index}`}
                  coordinate={{ latitude: car.latitude, longitude: car.longitude }}
                  title="Preview"
                  description="Ambient car. Not a driver you can request."
                  anchor={{ x: 0.5, y: 0.5 }}
                >
                  <View style={[styles.car, { backgroundColor: car.color }]}>
                    <Text style={styles.carGlyph}>🚗</Text>
                  </View>
                </Marker>
              )
            })
          : null}
        {route.length > 1 ? (
          <Polyline coordinates={route} strokeColor={colors.orange} strokeWidth={4} />
        ) : null}
        {pins.map((pin: MapPin) => (
          <Marker
            key={pin.id}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            title={pin.title}
            pinColor={pin.badge ? undefined : pin.color}
            anchor={pin.badge ? { x: 0.5, y: 0.5 } : undefined}
          >
            {pin.badge ? (
              <View style={[styles.stop, { backgroundColor: pin.color }]}>
                <Text style={styles.stopText}>{pin.badge}</Text>
              </View>
            ) : null}
          </Marker>
        ))}
        {userCoordinate ? (
          <Marker coordinate={userCoordinate} pinColor={colors.purple} title="You" />
        ) : null}
        {searchMotion
          ? simulatedFleet.map((car) => {
              const who = car.firstName || car.title || 'Driver'
              const vehicle = car.label || car.routeLabel
              return (
                <Marker
                  key={`search-${car.id}`}
                  coordinate={{ latitude: car.lat, longitude: car.lng }}
                  title={who}
                  description={vehicle}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges
                  onPress={() => {
                    refuseSimulatedDriverTap(car.id)
                  }}
                >
                  <SearchFleetGlyph
                    heading={car.heading}
                    livery={car.livery}
                    body={car.body}
                    label={`${who}, ${vehicle}`}
                  />
                </Marker>
              )
            })
          : null}
        {showSimulatedFleet && !searchMotion
          ? simulatedFleet.map((car) => (
              <Marker
                key={car.id}
                coordinate={{ latitude: car.lat, longitude: car.lng }}
                title={car.title}
                description={car.description}
                anchor={{ x: 0.5, y: 0.72 }}
                tracksViewChanges
                onPress={() => {
                  refuseSimulatedDriverTap(car.id)
                }}
              >
                <View style={styles.busyCar} accessibilityLabel={car.description}>
                  <View style={{ transform: [{ rotate: `${car.heading}deg` }] }}>
                    <View style={styles.busyGlyph} />
                  </View>
                  <Text style={styles.busyLabel}>Busy</Text>
                </View>
              </Marker>
            ))
          : null}
      </MapView>
      {showSimulatedFleet && !searchMotion ? (
        <View pointerEvents="none" style={styles.busyBadge}>
          <Text style={styles.busyBadgeText}>{SIMULATED_FLEET_BADGE}</Text>
        </View>
      ) : null}
      {gameDay ? (
        <View pointerEvents="none" style={styles.zone}>
          <Text style={[styles.zoneText, { backgroundColor: colors.orange, color: colors.onAccent }]}>
            {gameDayLabel || 'Game day'}
          </Text>
        </View>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  fill: { flex: 1 },
  unavailable: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F4F5F8',
  },
  unavailableTitle: { fontSize: 16, fontWeight: '800', color: '#522D80', marginBottom: 8 },
  unavailableBody: { fontSize: 14, lineHeight: 20, textAlign: 'center', color: '#5B6472' },
  car: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  carGlyph: { fontSize: 14 },
  stop: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  stopText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  zone: { position: 'absolute', left: 12, bottom: 12, right: 12, alignItems: 'flex-start' },
  zoneText: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: '800' },
  busyCar: { alignItems: 'center', width: 52 },
  busyGlyph: {
    width: 14,
    height: 22,
    borderRadius: 5,
    backgroundColor: '#522D80',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  busyLabel: {
    marginTop: 2,
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    backgroundColor: '#522D80',
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  busyBadge: { position: 'absolute', right: 12, bottom: 12 },
  busyBadgeText: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '800',
    backgroundColor: '#522D80',
    color: '#FFFFFF',
  },
})
