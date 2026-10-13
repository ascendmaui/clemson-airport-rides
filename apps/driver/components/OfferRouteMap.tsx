import { StyleSheet, Text, View } from 'react-native'
import { offerRouteLegs, offerRoutePoints } from 'rides-native/offerRoute.js'

type Coord = { latitude: number; longitude: number } | null

export function OfferRouteMap({
  driver,
  pickup,
  dropoff,
}: {
  driver: Coord
  pickup: Coord
  dropoff: Coord
}) {
  const legs = offerRouteLegs({ driver, pickup, dropoff })
  if (!legs.length) return null
  const points = offerRoutePoints({ driver, pickup, dropoff })
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Proposed route. Orange is you to pickup. Purple is pickup to drop-off."
      style={styles.map}
    >
      {legs.map((leg) => (
        <View key={leg.id} style={styles.leg}>
          <View style={[styles.swatch, { backgroundColor: leg.color }]} />
          <Text style={styles.label}>
            {leg.id === 'to-pickup' ? 'You to pickup' : 'Pickup to drop-off'}
          </Text>
        </View>
      ))}
      <View style={styles.track}>
        {points.driver && points.pickup ? <View style={[styles.stroke, { backgroundColor: '#F56600' }]} /> : null}
        {points.pickup && points.dropoff ? <View style={[styles.stroke, { backgroundColor: '#522D80' }]} /> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  map: { height: 132, borderRadius: 16, overflow: 'hidden', backgroundColor: '#E7E1F2', padding: 12, gap: 8, justifyContent: 'flex-end' },
  leg: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 18, height: 4, borderRadius: 2 },
  label: { fontWeight: '700', fontSize: 12, color: '#16121F' },
  track: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  stroke: { height: 6, flex: 1, borderRadius: 3 },
})
