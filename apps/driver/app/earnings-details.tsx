import { useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { CapsuleChart } from '@/components/charts'
import { ErrorText, Primary } from '@/components/chrome'
import { CircleButton, Segmented, StackPage, Toggle } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import {
  reportPeriod,
  shiftAnchor,
  type EarningsPeriod,
} from '@/lib/earningsMath'
import { shownCents } from '@/lib/shown'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { loadEarnings } from 'rides-native/driverDesk'

const PERIODS: { id: EarningsPeriod; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]

export default function EarningsDetails() {
  const router = useRouter()
  const { user } = useAuth()
  const { colors, earningsPrivate, setEarningsPrivate } = useTheme()
  const [period, setPeriod] = useState<EarningsPeriod>('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const [trips, setTrips] = useState<Awaited<ReturnType<typeof loadEarnings>>['trips']>([])
  const [balance, setBalance] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const data = await loadEarnings(supabase, user.id)
    setTrips(data.trips || [])
    setBalance(Number(data.payouts?.pendingCents) || 0)
    if (data.apiError) setError(data.apiError)
  }, [user])

  useFocusEffect(useCallback(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load earnings'))
  }, [refresh]))

  const report = reportPeriod(trips, period, anchor)
  const monthName = report.label

  return (
    <StackPage
      title=""
      onBack={() => router.back()}
      right={<CircleButton icon="close" label="Close" onPress={() => router.back()} />}
      footer={(
        <>
          <Text style={{ color: colors.ink, fontWeight: '800' }}>{shownCents(balance, earningsPrivate)} balance</Text>
          <Pressable onPress={() => router.push('/payouts')} style={[styles.cash, { backgroundColor: colors.fill }]}>
            <Text style={{ color: colors.onAccent, fontWeight: '800' }}>Cash out</Text>
          </Pressable>
        </>
      )}
    >
      <Segmented options={PERIODS} value={period} onChange={setPeriod} />
      <View style={styles.nav}>
        <Pressable onPress={() => setAnchor((current) => shiftAnchor(period, current, -1))} style={[styles.navBtn, { backgroundColor: colors.card }]}>
          <Text style={{ color: colors.title, fontWeight: '800' }}>{report.previousLabel}</Text>
        </Pressable>
        <Text style={[styles.period, { color: colors.ink }]}>{report.label}</Text>
        <Pressable onPress={() => setAnchor((current) => shiftAnchor(period, current, 1))} style={[styles.navBtn, { backgroundColor: colors.card }]}>
          <Text style={{ color: colors.title, fontWeight: '800' }}>{report.nextLabel}</Text>
        </Pressable>
      </View>
      <Text style={[styles.total, { color: colors.ink }]}>{shownCents(report.totalCents, earningsPrivate)}</Text>
      {earningsPrivate ? (
        <Text style={{ color: colors.inkSecondary }}>Chart hidden while earnings are private.</Text>
      ) : (
        <CapsuleChart bars={report.bars} formatValue={(cents) => shownCents(cents, false)} />
      )}
      <Text style={[styles.section, { color: colors.ink }]}>
        {period === 'month' ? `Your ${monthName} stats` : `Your ${period} stats`}
      </Text>
      <View style={styles.stats}>
        <View style={[styles.stat, { backgroundColor: colors.card }]}>
          <Text style={[styles.statKicker, { color: colors.title }]}>EARNINGS STATS</Text>
          <Text style={[styles.statValue, { color: colors.ink }]}>—</Text>
          <Text style={{ color: colors.inkSecondary }}>per booked hr</Text>
          <Text style={{ color: colors.inkSecondary }}>Booked hours are not tracked yet</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: colors.card }]}>
          <Text style={[styles.statKicker, { color: colors.title }]}>DRIVING STATS</Text>
          <View style={styles.statLine}>
            <Text style={{ color: colors.inkSecondary }}>Rides completed</Text>
            <Text style={{ color: colors.ink, fontWeight: '800' }}>{report.completed}</Text>
          </View>
          <View style={styles.statLine}>
            <Text style={{ color: colors.inkSecondary }}>Canceled</Text>
            <Text style={{ color: colors.ink, fontWeight: '800' }}>{report.canceled}</Text>
          </View>
          <View style={styles.statLine}>
            <Text style={{ color: colors.inkSecondary }}>Online</Text>
            <Text style={{ color: colors.ink, fontWeight: '800' }}>Not tracked</Text>
          </View>
        </View>
      </View>
      <Text style={[styles.section, { color: colors.ink }]}>Actions</Text>
      <View style={styles.action}>
        <Text style={{ color: colors.ink, fontWeight: '700', flex: 1 }}>Make earnings private</Text>
        <Toggle on={earningsPrivate} onPress={() => setEarningsPrivate(!earningsPrivate)} label="Make earnings private" />
      </View>
      <Pressable onPress={() => router.push('/driving-time')}>
        <Text style={{ color: colors.title, fontWeight: '800' }}>View driving time limits</Text>
      </Pressable>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {!user ? <Primary label="Sign in" onPress={() => router.push('/sign-in')} /> : null}
    </StackPage>
  )
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  navBtn: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  period: { fontWeight: '800', fontSize: 16 },
  total: { fontSize: 52, fontWeight: '800', letterSpacing: -1.2, marginTop: 8 },
  section: { fontSize: 22, fontWeight: '800', marginTop: 12 },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, borderRadius: 18, padding: 12, gap: 6 },
  statKicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  statValue: { fontSize: 26, fontWeight: '800' },
  statLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cash: { borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 },
})
