import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { CapsuleChart } from '@/components/charts'
import { Card, ErrorText, Primary, useCardShadow } from '@/components/chrome'
import { EmptyState, FadeIn, SoftNote } from '@/components/day'
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
  const shadow = useCardShadow()
  const [period, setPeriod] = useState<EarningsPeriod>('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const [trips, setTrips] = useState<Awaited<ReturnType<typeof loadEarnings>>['trips']>([])
  const [balance, setBalance] = useState(0)
  const [ready, setReady] = useState(!user)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const data = await loadEarnings(supabase, user.id)
    setTrips(data.trips || [])
    setBalance(Number(data.payouts?.pendingCents) || 0)
    if (data.apiError) setError(data.apiError)
  }, [user])

  useFocusEffect(useCallback(() => {
    if (!user) {
      setReady(true)
      return undefined
    }
    let alive = true
    refresh()
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load earnings')
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [refresh, user]))

  const report = reportPeriod(trips, period, anchor)
  const quiet = report.completed === 0 && report.canceled === 0

  return (
    <StackPage
      title="Earnings"
      onBack={() => router.back()}
      right={<CircleButton icon="close" label="Close" onPress={() => router.back()} />}
      footer={user && ready ? (
        <>
          <Text style={{ color: colors.ink, fontWeight: '800' }}>{shownCents(balance, earningsPrivate)} balance</Text>
          <Pressable onPress={() => router.push('/payouts')} style={[styles.cash, { backgroundColor: colors.fill }]} accessibilityRole="button">
            <Text style={{ color: colors.onAccent, fontWeight: '800' }}>Cash out</Text>
          </Pressable>
        </>
      ) : undefined}
    >
      {user && ready ? <Segmented options={PERIODS} value={period} onChange={setPeriod} /> : null}
      <FadeIn token={`${period}-${anchor.toISOString()}`} style={{ gap: 12 }}>
        {!user ? (
          <EmptyState
            icon="cash"
            title="Sign in to see earnings"
            body="Day, week, month, and year totals use completed trips on your driver account."
            action={<Primary label="Sign in" onPress={() => router.push('/sign-in')} />}
          />
        ) : null}
        {user && !ready ? (
          <Card>
            <Text style={{ color: colors.title, fontWeight: '800' }}>Loading earnings</Text>
            <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>Building this {period} from completed trips.</Text>
          </Card>
        ) : null}
        {user && ready ? (
          <>
            <View style={styles.nav}>
              <Pressable
                onPress={() => setAnchor((current) => shiftAnchor(period, current, -1))}
                style={[styles.navBtn, shadow, { backgroundColor: colors.card, borderColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel={report.previousLabel}
              >
                <Text style={{ color: colors.title, fontWeight: '800' }} numberOfLines={1}>{report.previousLabel}</Text>
              </Pressable>
              <Text style={[styles.period, { color: colors.ink }]}>{report.label}</Text>
              <Pressable
                onPress={() => setAnchor((current) => shiftAnchor(period, current, 1))}
                style={[styles.navBtn, shadow, { backgroundColor: colors.card, borderColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel={report.nextLabel}
              >
                <Text style={{ color: colors.title, fontWeight: '800' }} numberOfLines={1}>{report.nextLabel}</Text>
              </Pressable>
            </View>
            <Text style={[styles.total, { color: colors.ink }]}>{shownCents(report.totalCents, earningsPrivate)}</Text>
            <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
              {period === 'day'
                ? 'Night, morning, afternoon, and evening. Bars use the 80% you keep.'
                : 'Bars use the 80% you keep after the platform fee.'}
            </Text>
            {quiet ? (
              <SoftNote>
                {period === 'day'
                  ? 'No earnings this day. Finished rides add to the total. Canceled rides stay at zero.'
                  : `No earnings this ${period}. Finished rides add to the total. Canceled rides stay at zero.`}
              </SoftNote>
            ) : null}
            {earningsPrivate ? (
              <SoftNote>The chart is hidden while earnings are private on this phone.</SoftNote>
            ) : (
              <CapsuleChart bars={report.bars} formatValue={(cents) => shownCents(cents, false)} />
            )}
            <Text style={[styles.section, { color: colors.title }]}>
              {period === 'month' ? `Your ${report.label} stats` : `Your ${period} stats`}
            </Text>
            <View style={styles.stats}>
              <Card style={styles.stat}>
                <Text style={[styles.statKicker, { color: colors.orange }]}>EARNINGS STATS</Text>
                <Text style={[styles.statValue, { color: colors.ink }]}>—</Text>
                <Text style={{ color: colors.inkSecondary }}>per booked hour</Text>
                <Text style={{ color: colors.inkSecondary, lineHeight: 18 }}>Not recorded in this build.</Text>
              </Card>
              <Card style={styles.stat}>
                <Text style={[styles.statKicker, { color: colors.orange }]}>DRIVING STATS</Text>
                <View style={styles.statLine}>
                  <Text style={{ color: colors.inkSecondary }}>Rides</Text>
                  <Text style={{ color: colors.ink, fontWeight: '800' }}>{report.completed}</Text>
                </View>
                <View style={styles.statLine}>
                  <Text style={{ color: colors.inkSecondary }}>Canceled</Text>
                  <Text style={{ color: colors.ink, fontWeight: '800' }}>{report.canceled}</Text>
                </View>
                <View style={styles.statLine}>
                  <Text style={{ color: colors.inkSecondary }}>Online</Text>
                  <Text style={{ color: colors.ink, fontWeight: '800' }}>Not recorded</Text>
                </View>
              </Card>
            </View>
            <Text style={[styles.section, { color: colors.title }]}>Actions</Text>
            <Card>
              <View style={styles.action}>
                <Text style={{ color: colors.ink, fontWeight: '700', flex: 1 }}>Make earnings private</Text>
                <Toggle on={earningsPrivate} onPress={() => setEarningsPrivate(!earningsPrivate)} label="Make earnings private" />
              </View>
              <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
                Hides dollar amounts on this phone. Payouts still run on the account.
              </Text>
            </Card>
            <Pressable onPress={() => router.push('/driving-time')} accessibilityRole="button">
              <Card>
                <Text style={{ color: colors.title, fontWeight: '800' }}>Driving time limits</Text>
                <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
                  Hours online are not enforced in this build. Take breaks on your own.
                </Text>
              </Card>
            </Pressable>
          </>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
      </FadeIn>
    </StackPage>
  )
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  navBtn: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '30%', borderWidth: StyleSheet.hairlineWidth },
  period: { flex: 1, textAlign: 'center', fontWeight: '800', fontSize: 16 },
  total: { fontSize: 48, fontWeight: '800', letterSpacing: -1.2 },
  section: { fontSize: 22, fontWeight: '800', marginTop: 4 },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, gap: 6 },
  statKicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  statValue: { fontSize: 26, fontWeight: '800' },
  statLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cash: { borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 },
})
