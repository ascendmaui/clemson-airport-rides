import { memo, useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps'
import { sameRouteProps } from '@/lib/markerRedraw'
import { offerRouteLegs, offerRoutePoints, offerRouteRegion } from 'rides-native/offerRoute.js'
import { color as brand } from 'rides-native/shared/theme.js'

type Coord = { latitude: number; longitude: number } | null

const PAD = { top: 28, right: 28, bottom: 28, left: 28 }

function OfferRouteMapView({
  driver,
  pickup,
  dropoff,
}: {
  driver: Coord
  pickup: Coord
  dropoff: Coord
}) {
  const mapRef = useRef<MapView>(null)
  const points = offerRoutePoints({ driver, pickup, dropoff })
  const legs = offerRouteLegs({ driver, pickup, dropoff })
  const region = offerRouteRegion([points.driver, points.pickup, points.dropoff])
  const fitKey = legs.map((leg) => leg.coordinates.map((point) => `${point.latitude},${point.longitude}`).join('|')).join(';')
  const legsRef = useRef(legs)
  legsRef.current = legs
  useEffect(() => {
    const coordinates = legsRef.current.flatMap((leg) => leg.coordinates)
    if (coordinates.length < 2) return undefined
    const frame = requestAnimationFrame(() => {
      mapRef.current?.fitToCoordinates(coordinates, { edgePadding: PAD, animated: false })
    })
    return () => cancelAnimationFrame(frame)
  }, [fitKey])
  if (!region || !legs.length) return null
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Proposed route. Orange is you to pickup. Purple is pickup to drop-off."
      style={styles.map}
    >
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        pointerEvents="none"
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
      >
        {legs.map((leg) => (
          <Polyline key={leg.id} coordinates={leg.coordinates} strokeColor={leg.color} strokeWidth={4} />
        ))}
        {points.driver ? <Marker coordinate={points.driver} pinColor={brand.orange} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false} /> : null}
        {points.pickup ? <Marker coordinate={points.pickup} pinColor={brand.orange} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false} /> : null}
        {points.dropoff ? <Marker coordinate={points.dropoff} pinColor={brand.purple} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false} /> : null}
      </MapView>
    </View>
  )
}

const styles = StyleSheet.create({
  map: { height: 148, borderRadius: 16, overflow: 'hidden' },
})

/** Memoised: the offer card ticks every second, but the map only re-renders when a pin moves. */
export const OfferRouteMap = memo(OfferRouteMapView, sameRouteProps)
