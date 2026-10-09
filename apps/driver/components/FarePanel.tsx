import { StyleSheet, Text, View } from 'react-native'
import { driverFareNote, fareCollection, formatCents, incentiveLabel, type DriverCard } from 'rides-native/tripTags'
import { useTheme } from '@/lib/theme'

export function FarePanel({ card }: { card: DriverCard }) {
  const { colors } = useTheme()
  const fare = fareCollection(card)
  // One net number: the bold total always equals the trip header (card.driverNetCents).
  const hasExtras = fare.boostNetCents > 0 || fare.backupBonusCents > 0 || fare.waitNetCents > 0
  const fareNetLabel = fare.sharePercent != null ? `Fare net · ${fare.sharePercent}%` : 'Fare net'
  return (
    <View style={[styles.box, { backgroundColor: colors.track }]}>
      <Text style={[styles.title, { color: colors.title }]}>Fare</Text>
      <Row label="Trip fare" value={formatCents(fare.fareCents)} />
      {fare.depositCents > 0 ? <Row label="Already paid" value={formatCents(fare.depositCents)} /> : null}
      <Row label="Charged at trip end" value={formatCents(fare.remainderCents)} />
      {fare.carpoolIncentiveId ? (
        <>
          <Row label="Base net" value={formatCents(fare.baseNetCents || 0)} />
          <Row label={incentiveLabel(fare.carpoolIncentiveId)} value={formatCents(fare.carpoolBonusCents || 0)} />
        </>
      ) : null}
      {hasExtras ? (
        <>
          {!fare.carpoolIncentiveId ? <Row label={fareNetLabel} value={formatCents(fare.driverNetCents)} /> : null}
          {fare.boostNetCents > 0 ? <Row label="Boost · your share" value={formatCents(fare.boostNetCents)} /> : null}
          {fare.backupBonusCents > 0 ? <Row label="Backup bonus" value={formatCents(fare.backupBonusCents)} /> : null}
          {fare.waitNetCents > 0 ? <Row label="Wait time" value={formatCents(fare.waitNetCents)} /> : null}
          <Row label="You net" value={formatCents(fare.totalNetCents)} strong />
        </>
      ) : (
        <Row label={fare.carpoolIncentiveId ? 'You net' : fareNetLabel.replace('Fare net', 'You net')} value={formatCents(fare.totalNetCents)} strong />
      )}
      <Text style={[styles.note, { color: colors.inkSecondary }]}>
        {fare.sharePercent != null
          ? `Platform fee ${formatCents(fare.platformFeeCents)} · ${100 - fare.sharePercent}%.`
          : `Platform fee ${formatCents(fare.platformFeeCents)}.`}
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
