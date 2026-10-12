import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useCardShadow } from '@/components/chrome'
import { dollarsPerHour, loadForecast, type ForecastSlot } from '@/lib/forecast'
import { useTheme } from '@/lib/theme'
import { formatSlotWindow } from 'rides-native/earningsForecast.js'

/** Compact Home card: best upcoming window + zone. Tap for the 7-day detail. */
export function ForecastCard() {
  const router = useRouter()
  const { colors } = useTheme()
  const shadow = useCardShadow()
  const [best, setBest] = useState<ForecastSlot | null>(null)
  const [lowData, setLowData] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    loadForecast()
      .then((data) => {
        if (!alive) return
        setBest(data.top[0] || null)
        setLowData(data.lowData)
      })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [])

  if (failed) return null
  const line = best
    ? `${formatSlotWindow(best)} · ${best.zoneLabel} · ~${dollarsPerHour(best.expectedCentsPerHour)}`
    : 'Loading next 7 days…'
  return (
    <Pressable
      onPress={() => router.push('/forecast')}
      accessibilityRole="button"
      accessibilityLabel={`Earnings forecast, estimate. Best upcoming window: ${line}`}
      accessibilityHint="Opens the 7-day earnings forecast"
      style={[styles.card, shadow, { backgroundColor: colors.card }]}
    >
      <View style={styles.row}>
        <Text style={[styles.kicker, { color: colors.orange }]}>BEST HOURS · ESTIMATE</Text>
        <Text style={{ color: colors.inkSecondary, fontWeight: '800' }}>7 days ›</Text>
      </View>
      <Text style={{ color: colors.title, fontWeight: '800' }} numberOfLines={1}>{line}</Text>
      {lowData ? (
        <Text style={{ color: colors.inkSecondary, fontSize: 11 }}>Few past trips: based on events and typical demand.</Text>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 8, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
})
