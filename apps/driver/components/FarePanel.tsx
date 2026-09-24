import { StyleSheet, Text, View } from 'react-native'
import { APPLE_PAY_DRIVER_COPY, fareCollection, formatCents, type DriverCard } from 'rides-native/tripTags'
import { INK, INK_SECONDARY, ORANGE, PURPLE } from 'rides-native/places.js'

export function FarePanel({ card }: { card: DriverCard }) {
  const fare = fareCollection(card)
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Fare</Text>
      <Row label="Trip fare" value={formatCents(fare.fareCents)} />
      <Row label="25% deposit" value={formatCents(fare.depositCents)} />
      <Row label="Collected on complete" value={formatCents(fare.remainderCents)} />
      <Row label="You net · 80%" value={formatCents(fare.driverNetCents)} strong />
      <Text style={styles.note}>Platform fee {formatCents(fare.platformFeeCents)} · 20%.</Text>
      {fare.shares.length > 1 ? (
        <View style={styles.splits}>
          <Text style={styles.splitTitle}>Carpool split</Text>
          {fare.shares.map((share) => (
            <Row key={share.id} label={share.label} value={formatCents(share.shareCents)} />
          ))}
        </View>
      ) : null}
      <Text style={styles.note}>{APPLE_PAY_DRIVER_COPY}</Text>
    </View>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.value, strong && styles.strong]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  box: { backgroundColor: 'rgba(82,45,128,0.06)', borderRadius: 16, padding: 12, gap: 6 },
  title: { color: PURPLE, fontWeight: '800' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  label: { color: INK_SECONDARY, fontSize: 13 },
  value: { color: INK, fontWeight: '700', fontSize: 13 },
  strong: { color: PURPLE, fontWeight: '800' },
  note: { color: INK_SECONDARY, fontSize: 12, lineHeight: 17 },
  splits: { gap: 4, paddingTop: 4 },
  splitTitle: { color: ORANGE, fontWeight: '800', fontSize: 12, letterSpacing: 0.4 },
})
