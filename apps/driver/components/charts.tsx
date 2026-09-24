import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@/lib/theme'
import type { Palette } from '@/lib/palette'

export function DonutChart({
  segments,
}: {
  segments: { label: string; value: number; color: string }[]
}) {
  const { colors } = useTheme()
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0)
  const slices = 48
  const paint: string[] = []
  if (total <= 0) {
    for (let index = 0; index < slices; index += 1) paint.push(colors.track)
  } else {
    for (const segment of segments) {
      const count = Math.max(0, Math.round((Math.max(0, segment.value) / total) * slices))
      for (let index = 0; index < count; index += 1) paint.push(segment.color)
    }
    while (paint.length < slices) paint.push(segments[segments.length - 1]?.color || colors.track)
    paint.length = slices
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.ring}>
        {paint.map((color, index) => (
          <View key={`${color}-${index}`} style={styles.sliceBox} pointerEvents="none">
            <View
              style={[
                styles.slice,
                {
                  backgroundColor: color,
                  transform: [{ rotate: `${index * (360 / slices)}deg` }],
                },
              ]}
            />
          </View>
        ))}
        <View style={[styles.hole, { backgroundColor: colors.card }]} />
      </View>
      <View style={styles.legend}>
        {segments.map((segment) => (
          <View key={segment.label} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: segment.color }]} />
            <Text style={[styles.legendText, { color: colors.ink }]}>
              {total <= 0 ? '—' : `${Math.round((Math.max(0, segment.value) / total) * 100)}%`} {segment.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

export function CapsuleChart({
  bars,
  formatValue,
}: {
  bars: { key: string; label: string; cents: number }[]
  formatValue: (cents: number) => string
}) {
  const { colors } = useTheme()
  const max = Math.max(1, ...bars.map((bar) => bar.cents))
  return (
    <View style={styles.chart}>
      {bars.map((bar) => {
        const empty = bar.cents <= 0
        const peak = !empty && bar.cents === max
        const height = empty ? 10 : Math.max(22, Math.round((bar.cents / max) * 112))
        return (
          <View key={bar.key} style={styles.column}>
            <Text style={[styles.amount, { color: colors.inkSecondary }]} numberOfLines={1}>
              {bar.cents > 0 ? formatValue(bar.cents) : ''}
            </Text>
            <View
              style={{
                width: bars.length > 8 ? 10 : 16,
                height,
                borderRadius: 999,
                backgroundColor: empty ? colors.segment : peak ? colors.barPeak : colors.bar,
              }}
            />
            <Text style={[styles.axis, { color: colors.inkSecondary }]} numberOfLines={1}>
              {bar.label}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

export function legendColor(colors: Palette, slot: 'you' | 'platform' | 'other'): string {
  switch (slot) {
    case 'you':
      return colors.purple
    case 'platform':
      return colors.orange
    case 'other':
      return colors.inkSecondary
    default: {
      const unknown: never = slot
      return unknown
    }
  }
}

const SIZE = 132

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ring: { width: SIZE, height: SIZE },
  sliceBox: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
  },
  slice: {
    width: 12,
    height: SIZE / 2,
    borderRadius: 8,
    transformOrigin: '6px 100%',
  },
  hole: {
    position: 'absolute',
    width: 78,
    height: 78,
    borderRadius: 39,
    left: (SIZE - 78) / 2,
    top: (SIZE - 78) / 2,
  },
  legend: { flex: 1, gap: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontWeight: '700', fontSize: 14, flex: 1 },
  chart: {
    minHeight: 168,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 4,
    paddingTop: 8,
  },
  column: { flex: 1, alignItems: 'center', gap: 6 },
  amount: { fontSize: 11, fontWeight: '800', minHeight: 14 },
  axis: { fontSize: 11, fontWeight: '700' },
})
