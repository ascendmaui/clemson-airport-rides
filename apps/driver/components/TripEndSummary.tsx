import { StyleSheet, Text, View } from 'react-native'
import { tripEndSummary } from 'rides-native/tripEndSummary'
import type { DriverCard } from 'rides-native/tripTags'
import { useTheme } from '@/lib/theme'

/** Completed-trip summary. Net is DriverCard.driverNetCents, the same number the payout queue pays. */
export function TripEndSummary({ card }: { card: DriverCard }) {
  const { colors } = useTheme()
  const summary = tripEndSummary(card)
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={summary.accessibilityLabel}
      style={[styles.box, { backgroundColor: colors.track, borderColor: colors.orange }]}
    >
      <Text style={[styles.kicker, { color: colors.orange }]}>{summary.title.toUpperCase()}</Text>
      <Text style={[styles.net, { color: colors.title }]}>{summary.net.value}</Text>
      <Text style={[styles.netLabel, { color: colors.inkSecondary }]}>{summary.net.label}</Text>
      <View style={styles.lines}>
        {summary.lines.map((line) => (
          <View key={line.key}>
            <View style={styles.row}>
              <Text style={[styles.label, { color: colors.inkSecondary }]}>{line.label}</Text>
              <Text style={[styles.value, { color: colors.ink }]}>{line.value}</Text>
            </View>
            {line.note ? <Text style={[styles.note, { color: colors.inkSecondary }]}>{line.note}</Text> : null}
          </View>
        ))}
        <View style={[styles.row, styles.total, { borderColor: colors.border }]}>
          <Text style={[styles.label, styles.strong, { color: colors.title }]}>{summary.net.label}</Text>
          <Text style={[styles.value, styles.strong, { color: colors.title }]}>{summary.net.value}</Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { color: colors.inkSecondary }]}>{summary.tip.label}</Text>
          <Text style={[styles.value, { color: summary.tip.pending ? colors.inkSecondary : colors.ink }]}>{summary.tip.value}</Text>
        </View>
        <Text style={[styles.note, { color: colors.inkSecondary }]}>{summary.tip.note}</Text>
      </View>
      <Text style={[styles.note, { color: colors.inkSecondary }]}>{summary.payoutLine}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderRadius: 18, borderWidth: 2, padding: 14, gap: 4 },
  kicker: { fontWeight: '800', letterSpacing: 1, fontSize: 12 },
  net: { fontSize: 36, fontWeight: '900' },
  netLabel: { fontSize: 13, fontWeight: '700' },
  lines: { gap: 6, paddingTop: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  total: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  label: { fontSize: 14, fontWeight: '700' },
  value: { fontSize: 14, fontWeight: '700' },
  strong: { fontWeight: '900' },
  note: { fontSize: 12, lineHeight: 17 },
})
