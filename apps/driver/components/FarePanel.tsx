import { StyleSheet, Text, View } from 'react-native'
import { driverFareNote, fareCollection, formatCents, type DriverCard } from 'rides-native/tripTags'
import { useTheme } from '@/lib/theme'

export function FarePanel({ card }: { card: DriverCard }) {
  const { colors } = useTheme()
  const fare = fareCollection(card)
  return (
    <View style={[styles.box, { backgroundColor: colors.track }]}>
      <Text style={[styles.title, { color: colors.title }]}>Fare</Text>
      <Row label="Trip fare" value={formatCents(fare.fareCents)} />
      <Row label="25% deposit" value={formatCents(fare.depositCents)} />
      <Row label="Collected on complete" value={formatCents(fare.remainderCents)} />
      {fare.carpoolIncentiveId ? (
        <>
          <Row label="Base net" value={formatCents(fare.baseNetCents || 0)} />
          <Row label={`Carpool bonus · ${fare.carpoolIncentiveId}`} value={formatCents(fare.carpoolBonusCents || 0)} />
          <Row label="You net" value={formatCents(fare.driverNetCents)} strong />
        </>
      ) : (
        <Row label={fare.usesStoredPayout ? 'You net' : 'You net · 80%'} value={formatCents(fare.driverNetCents)} strong />
      )}
      <Text style={[styles.note, { color: colors.inkSecondary }]}>
        {fare.carpoolIncentiveId
          ? `Platform fee ${formatCents(fare.platformFeeCents)}.`
          : `Platform fee ${formatCents(fare.platformFeeCents)} · 20%.`}
      </Text>
      {fare.shares.length > 1 ? (
        <View style={styles.splits}>
          <Text style={[styles.splitTitle, { color: colors.orange }]}>Carpool split</Text>
          {fare.shares.map((share) => (
            <Row key={share.id} label={share.label} value={formatCents(share.shareCents)} />
          ))}
        </View>
      ) : null}
      <Text style={[styles.note, { color: colors.inkSecondary }]}>{driverFareNote(fare.depositCents)}</Text>
    </View>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const { colors } = useTheme()
  const tone = { color: strong ? colors.title : colors.inkSecondary, fontWeight: strong ? '800' as const : '700' as const }
  return (
    <View style={styles.row}>
      <Text style={[styles.label, tone]}>{label}</Text>
      <Text style={[styles.value, { color: strong ? colors.title : colors.ink }, strong && styles.strong]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderRadius: 16, padding: 12, gap: 6 },
  title: { fontWeight: '800' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  label: { fontSize: 13 },
  value: { fontWeight: '700', fontSize: 13 },
  strong: { fontWeight: '800' },
  note: { fontSize: 12, lineHeight: 17 },
  splits: { gap: 4, paddingTop: 4 },
  splitTitle: { fontWeight: '800', fontSize: 12, letterSpacing: 0.4 },
})
