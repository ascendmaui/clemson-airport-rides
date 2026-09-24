import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import MapView, { Circle, Marker, PROVIDER_DEFAULT } from 'react-native-maps'
import { heatColor } from 'rides-native/heat.js'
import { DOWNTOWN, STADIUM } from 'rides-native/places.js'
import type { CampusMapHandle, CampusMapProps } from '@/components/mapTypes'
import { useTheme } from '@/lib/theme'

function rgba(hex: string, alpha: number) {
  const raw = hex.replace('#', '')
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
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
    gameDay = false,
    surge = false,
    userCoordinate = null,
    pins = [],
  },
  ref,
) {
  const { colors, scheme } = useTheme()
  const mapRef = useRef<MapView>(null)
  const [tick, setTick] = useState(0)
  const [radar, setRadar] = useState(90)
  const center = showHeat ? DOWNTOWN : STADIUM

  useImperativeHandle(ref, () => ({
    animateTo(coord, delta = 0.018) {
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

  useEffect(() => {
    if (!theater) return undefined
    const id = setInterval(() => {
      setTick((value) => value + 1)
      setRadar((value) => (value > 320 ? 80 : value + 36))
    }, 700)
    return () => clearInterval(id)
  }, [theater])

  return (
    <View style={styles.fill}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: center.latitude,
          longitude: center.longitude,
          latitudeDelta: showHeat ? 0.028 : 0.04,
          longitudeDelta: showHeat ? 0.028 : 0.04,
        }}
        mapType={mapType}
        userInterfaceStyle={scheme}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsUserLocation={false}
      >
        <Marker coordinate={STADIUM} pinColor={colors.orange} title="Memorial Stadium" />
        <Marker coordinate={DOWNTOWN} pinColor={colors.purple} title="Downtown Clemson" />
        {showHeat
          ? spots.map((spot) => (
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
        {theater ? (
          <Circle
            center={STADIUM}
            radius={radar}
            fillColor={colors.orangeSoft}
            strokeColor={tick % 2 === 0 ? colors.orange : colors.purple}
            strokeWidth={2}
          />
        ) : null}
        {theater
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
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            title={pin.title}
            pinColor={pin.color}
          />
        ))}
        {userCoordinate ? (
          <Marker coordinate={userCoordinate} pinColor={colors.purple} title="You" />
        ) : null}
      </MapView>
    </View>
  )
})

const styles = StyleSheet.create({
  fill: { flex: 1 },
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
})
