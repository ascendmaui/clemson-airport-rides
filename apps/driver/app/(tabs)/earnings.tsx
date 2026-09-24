import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DonutChart, legendColor } from '@/components/charts'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { currentWeekLabel, tipCentsFromPayments, type TipPayment } from '@/lib/earningsMath'
import { shownCents } from '@/lib/shown'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { driverNetCents, weekNetCents } from 'rides-native/tripTags'
import { loadEarnings } from 'rides-native/driverDesk'

type EarningsState = Awaited<ReturnType<typeof loadEarnings>> | null

export default function EarningsHub() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors, earningsPrivate } = useTheme()
  const [data, setData] = useState<EarningsState>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    setData(await loadEarnings(supabase, user.id))
  }, [user])

  useFocusEffect(useCallback(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load earnings'))
  }, [refresh]))

  const payouts = data?.payouts
  const week = weekNetCents(data?.trips || [])
  const pending = Number(payouts?.pendingCents) || 0
  const nextRetry = payouts?.pending?.find((row) => row && typeof row === 'object' && 'nextRetryAt' in row) as { nextRetryAt?: string } | undefined
  let you = 0
  let platform = 0
  let other = 0
  for (const trip of data?.trips || []) {
    if (trip.status !== 'completed') continue
    const fare = Math.max(0, Math.round(Number(trip.fare_cents) || 0))
    const net = driverNetCents(fare)
    you += net
    platform += Math.max(0, fare - net)
    const payments = (data?.paymentsByTrip?.[trip.id] || []) as TipPayment[]
    other += tipCentsFromPayments(payments)
  }
  const standard = you + platform + other <= 0
  const segments = standard
    ? [
        { label: 'You', value: 80, color: legendColor(colors, 'you') },
        { label: 'Clemson RIDES', value: 20, color: legendColor(colors, 'platform') },
        { label: 'Other', value: 0, color: legendColor(colors, 'other') },
      ]
    : [
        { label: 'You', value: you, color: legendColor(colors, 'you') },
        { label: 'Clemson RIDES', value: platform, color: legendColor(colors, 'platform') },
        { label: 'Other', value: other, color: legendColor(colors, 'other') },
      ]

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={[styles.title, { color: colors.title }]}>Earnings</Text>
        <Card>
          <Text style={{ color: colors.inkSecondary, fontWeight: '700' }}>{currentWeekLabel()}</Text>
          <Text style={[styles.amount, { color: colors.ink }]}>{shownCents(week, earningsPrivate)}</Text>
          <Primary label="See details" onPress={() => router.push('/earnings-details')} tone="ghost" />
        </Card>
        <Text style={[styles.section, { color: colors.title }]}>Wallet</Text>
        <Card>
          <Text style={{ color: colors.inkSecondary, fontWeight: '700' }}>Balance</Text>
          <Text style={[styles.amount, { color: colors.ink }]}>{shownCents(pending, earningsPrivate)}</Text>
          <Text style={{ color: colors.inkSecondary }}>
            {nextRetry?.nextRetryAt
              ? `Next payout retry ${new Date(nextRetry.nextRetryAt).toLocaleString()}`
              : 'Payouts move when a Stripe transfer is due.'}
          </Text>
          <Pressable onPress={() => router.push('/payouts')} style={[styles.cash, { backgroundColor: colors.track }]}>
            <Text style={{ color: colors.title, fontWeight: '800' }}>Cash out and more</Text>
          </Pressable>
        </Card>
        <Text style={[styles.section, { color: colors.title }]}>Customer fare breakdown</Text>
        <Card>
          <Text style={{ color: colors.inkSecondary }}>
            {standard ? 'Standard split until a completed trip is on file. You keep 80%.' : 'Completed trips on this phone’s earnings list.'}
          </Text>
          {earningsPrivate ? (
            <Text style={{ color: colors.title, fontWeight: '800' }}>Amounts hidden</Text>
          ) : (
            <DonutChart segments={segments} />
          )}
          <Text style={{ color: colors.inkSecondary }}>Paid out {shownCents(Number(payouts?.paidCents) || 0, earningsPrivate)} stays in payout history.</Text>
        </Card>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {data?.apiError ? <ErrorText>{`Deposit rows: ${data.apiError}`}</ErrorText> : null}
        {data?.payoutError ? <ErrorText>{`Payout status: ${data.payoutError}`}</ErrorText> : null}
        {!user ? <Primary label="Sign in" onPress={() => router.push('/sign-in')} /> : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: 16, gap: 8, paddingBottom: 32 },
  title: { fontSize: 32, fontWeight: '800', marginBottom: 4 },
  section: { fontSize: 22, fontWeight: '800', marginTop: 8 },
  amount: { fontSize: 34, fontWeight: '800', letterSpacing: -0.6 },
  cash: { borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
})
