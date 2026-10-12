import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ErrorText, Primary } from '@/components/chrome'
import { DayHeader, EmptyState, FadeIn, SoftNote } from '@/components/day'
import {
  BoardNote,
  EarningsHero,
  ForecastPanel,
  LinkRow,
  PeriodCharts,
  PayoutPanel,
  RideList,
  StreakCardView,
  TipsCard,
  type DashPeriod,
} from '@/components/EarningsBoard'
import { useAuth } from '@/lib/auth'
import { reportPeriod, selectPeriodTrips } from '@/lib/earningsMath'
import { shownCents } from '@/lib/shown'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { authedJson } from 'rides-native/apiClient'
import { loadEarnings } from 'rides-native/driverDesk'
import {
  forecastHighlights,
  payoutTimeline,
  rideDetails,
  streakBoard,
  tipsBreakdown,
  type DriverPerks,
  type ForecastPayload,
} from 'rides-native/earningsDashboard.js'
import { carpoolPayFromTrip } from 'rides-native/tripTags'
import { carpoolPayFromTrip, tripEarnedCents, tripPayoutCents, weekNetCents } from 'rides-native/tripTags'
import { driverBoostShareCents, readBoostCents } from '../../../../shared/scheduledBoost.js'
import { instantCashout, loadCashoutQuote, loadEarnings, type CashoutQuote } from 'rides-native/driverDesk'
import { CASHOUT_COPY } from '../../../../shared/cashout.js'
import { readPrepaidTipCents } from '../../../../shared/prepaidTip.js'

type EarningsState = Awaited<ReturnType<typeof loadEarnings>> | null

async function loadOptional<T>(path: string): Promise<T | null> {
  try {
    return await authedJson(supabase, path) as T
  } catch {
    return null
  }
}

export default function EarningsHub() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors, earningsPrivate } = useTheme()
  const [period, setPeriod] = useState<DashPeriod>('week')
  const [anchor] = useState(() => new Date())
  const [data, setData] = useState<EarningsState>(null)
  const [perks, setPerks] = useState<DriverPerks | null>(null)
  const [forecast, setForecast] = useState<ForecastPayload | null>(null)
  const [perkNote, setPerkNote] = useState<string | null>(null)
  const [forecastNote, setForecastNote] = useState<string | null>(null)
  const [ready, setReady] = useState(!user)
  const [error, setError] = useState<string | null>(null)

  const [quote, setQuote] = useState<CashoutQuote | null>(null)
  const [cashing, setCashing] = useState(false)

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    setData(await loadEarnings(supabase, user.id))
    setQuote(await loadCashoutQuote(supabase).catch(() => null))
  }, [user])

  const money = (cents?: number) => `$${((cents || 0) / 100).toFixed(2)}`
  const runCashout = useCallback(() => {
    if (!quote || !supabase) return
    if (quote.state === 'needs_setup') {
      router.push('/payouts')
      return
    }
    if (quote.state !== 'ready') return
    const instant = quote.method === 'instant'
    const lines = [
      `Balance ${money(quote.grossCents)}`,
      instant ? `Instant fee ${money(quote.feeCents)}` : 'No fee (standard payout, 1-2 business days)',
      `You get ${money(quote.netCents)}${quote.last4 ? ` to •••• ${quote.last4}` : ''}`,
      'One cash-out per day.',
    ]
    Alert.alert(instant ? 'Instant cash-out' : 'Cash out', lines.join('\n'), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: `Cash out ${money(quote.netCents)}`,
        onPress: async () => {
          setCashing(true)
          try {
            const r = await instantCashout(supabase, quote.feeCents || 0)
            if (r.ok) {
              Alert.alert('Cash-out sent', r.method === 'instant'
                ? `${money(r.netCents)} is on its way to your debit card.`
                : `${money(r.netCents)} is on its way by standard payout${r.fallbackReason ? ' (instant was not available for this card)' : ''}.`)
            } else {
              Alert.alert('Cash-out not sent', CASHOUT_COPY[r.error as keyof typeof CASHOUT_COPY] || 'Try again in a few minutes.')
            }
          } catch (err) {
            Alert.alert('Cash-out not sent', err instanceof Error ? err.message : 'Try again in a few minutes.')
          } finally {
            setCashing(false)
            refresh().catch(() => {})
          }
        },
      },
    ])
  }, [quote, refresh, router])

  useFocusEffect(useCallback(() => {
    if (!user || !supabase) {
      setReady(true)
      return undefined
    }
    let alive = true
    loadEarnings(supabase, user.id)
      .then(async (next) => {
        if (!alive) return
        setData(next)
        const [perkPayload, forecastPayload] = await Promise.all([
          loadOptional<DriverPerks>('/api/driver?action=perks'),
          loadOptional<ForecastPayload>('/api/driver?action=forecast'),
        ])
        if (!alive) return
        setPerks(perkPayload)
        setForecast(forecastPayload)
        setPerkNote(perkPayload?.streaks ? null : 'Streaks and bonuses are unavailable right now.')
        setForecastNote(forecastPayload?.top ? null : 'Best hours and zones are unavailable right now.')
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load earnings')
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [user]))

  const trips = data?.trips || []
  const payments = data?.paymentsByTrip || {}
  const day = reportPeriod(trips, 'day', anchor)
  const week = reportPeriod(trips, 'week', anchor)
  const month = reportPeriod(trips, 'month', anchor)
  const selected = selectedReport(period, day, week, month)
  const inPeriod = selectPeriodTrips(trips, period, anchor)
  const tips = tipsBreakdown(inPeriod, payments)
  const rides = rideDetails(inPeriod, payments)
  const streaks = streakBoard(perks)
  const outlook = forecastHighlights(forecast)
  const payouts = payoutTimeline({
    trips,
    payouts: data?.payouts,
    bonuses: streaks.bonuses,
    now: anchor.getTime(),
  })
  const money = (cents: number) => shownCents(cents, earningsPrivate)
  const carpool = inPeriod.some((trip) => trip.status === 'completed' && carpoolPayFromTrip(trip)?.showBonus)
  const chartCaption = period === 'day'
    ? 'Night, morning, afternoon, and evening. Bars are the amount you keep.'
    : carpool
      ? 'Bars are your payout, including any carpool bonus.'
      : 'Bars are the amount you keep after the platform fee.'
  const payouts = data?.payouts
  const week = weekNetCents(data?.trips || [])
  const pending = Number(payouts?.pendingCents) || 0
  const nextRetry = payouts?.pending?.find((row: unknown) => row && typeof row === 'object' && 'nextRetryAt' in row) as { nextRetryAt?: string } | undefined
  let you = 0
  let platform = 0
  let other = 0
  let boostSum = 0
  let tips = 0
  let carpoolBonus = false
  for (const trip of data?.trips || []) {
    if (trip.status === 'cancelled_wait') {
      const net = tripEarnedCents(trip)
      you += net
      platform += Math.max(0, (trip.wait_fee_cents || 0) + (trip.cancel_fee_cents || 0) - net)
      continue
    }
    if (trip.status !== 'completed') continue
    const fare = Math.max(0, Math.round(Number(trip.fare_cents) || 0))
    const net = tripEarnedCents(trip)
    const boost = driverBoostShareCents(readBoostCents(trip))
    if (carpoolPayFromTrip(trip)?.showBonus) carpoolBonus = true
    you += net
    boostSum += boost
    platform += Math.max(0, fare + (trip.wait_fee_cents || 0) - net)
    const payments = (data?.paymentsByTrip?.[trip.id] || []) as TipPayment[]
    // Tips (after-ride and prepaid tip boost) are 100% the driver's, shown on their own slice.
    tips += tipCentsFromPayments(payments) + readPrepaidTipCents(trip)
  }
  const standard = you + platform + other + boostSum + tips <= 0
  const segments = standard
    ? [
        { label: 'You', value: 80, color: legendColor(colors, 'you') },
        { label: 'Clemson RIDES', value: 20, color: legendColor(colors, 'platform') },
        { label: 'Other', value: 0, color: legendColor(colors, 'other') },
      ]
    : [
        { label: 'You', value: you, color: legendColor(colors, 'you') },
        { label: 'Clemson RIDES', value: platform, color: legendColor(colors, 'platform') },
        { label: 'Boost', value: boostSum, color: '#F56600' },
        { label: 'Tips (100% yours)', value: tips, color: '#22A04B' },
        { label: 'Other', value: other, color: legendColor(colors, 'other') },
      ]

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <FadeIn style={{ gap: 14 }}>
          <DayHeader kicker="CLEMSON RIDES" title="Earnings" />
          {!user ? (
            <EmptyState
              icon="cash"
              title="Sign in to see earnings"
              body="Day, week, and month charts, tips, streaks, and payouts appear after you sign in."
              action={<Primary label="Sign in" onPress={() => router.push('/sign-in')} />}
            />
          ) : null}
          {user && !ready ? (
            <SoftNote>Loading earnings, tips, and payout balance.</SoftNote>
          ) : null}
          {user && ready ? (
            <>
              <EarningsHero
                period={period}
                amount={money(selected.totalCents)}
                label={selected.label}
                rides={selected.completed}
                tips={money(tips.tipCents)}
              />
              <PeriodCharts
                selected={period}
                onSelect={setPeriod}
                totals={{ day: money(day.totalCents), week: money(week.totalCents), month: money(month.totalCents) }}
                bars={selected.bars}
                caption={chartCaption}
                split={`${money(selected.youCents)} you · ${money(selected.platformCents)} Clemson RIDES`}
                hidden={earningsPrivate}
              />
              <BoardNote>
                {carpool
                  ? 'This period includes carpool payouts. Totals include the carpool bonus. Tips are listed on their own.'
                  : 'You keep 80% of each fare. Tips, boosts, and streak bonuses are listed apart from that split.'}
              </BoardNote>
              <TipsCard tips={tips} money={money} />
              <StreakCardView board={streaks} note={perkNote} money={money} />
              <ForecastPanel forecast={outlook} note={forecastNote} money={money} />
              <PayoutPanel timeline={payouts} money={money} onOpen={() => router.push('/payouts')} />
              <RideList rides={rides} money={money} onOpen={(id) => router.push({ pathname: '/trip-details', params: { id } })} />
              <LinkRow
                label="All activity"
                hint="Opens completed and canceled rides"
                onPress={() => router.push('/earnings-activity')}
              />
              <LinkRow
                label="Year and earlier periods"
                hint="Opens earnings details"
                onPress={() => router.push('/earnings-details')}
              />
              {week <= 0 ? (
                <SoftNote>No completed trips this week. You keep 80% of each fare once a ride finishes. Carpool trips add a carpool bonus to your payout.</SoftNote>
              ) : (
                <SoftNote>
                  {carpoolBonus
                    ? 'This week includes carpool payouts. Totals include the carpool bonus.'
                    : 'This week’s total is the 80% you keep. Open details for day, week, month, and year.'}
                </SoftNote>
              )}
              <SectionLabel>Wallet</SectionLabel>
              <Card>
                <Text style={[styles.kicker, { color: colors.orange }]}>BALANCE</Text>
                <Text style={[styles.amount, { color: colors.ink }]}>{shownCents(pending, earningsPrivate)}</Text>
                <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
                  {nextRetry?.nextRetryAt
                    ? `Next payout retry ${new Date(nextRetry.nextRetryAt).toLocaleString()}`
                    : pending > 0
                      ? 'This balance pays out when a Stripe transfer is due.'
                      : 'Nothing is waiting to pay out. Completed trips land here after Stripe records them.'}
                </Text>
                <Pressable
                  onPress={runCashout}
                  disabled={cashing || !quote || (quote.state !== 'ready' && quote.state !== 'needs_setup')}
                  style={[styles.cash, { backgroundColor: quote?.state === 'ready' ? colors.orange : colors.track, opacity: cashing ? 0.6 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Instant cash-out"
                  accessibilityHint="Shows the fee and asks you to confirm before sending your balance"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={{ color: quote?.state === 'ready' ? '#FFFFFF' : colors.title, fontWeight: '800' }}>
                    {cashing ? 'Sending…' : quote?.state === 'needs_setup' ? 'Set up payouts to cash out' : 'Instant cash-out'}
                  </Text>
                </Pressable>
                {quote && quote.state !== 'ready' && quote.state !== 'needs_setup' ? (
                  <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{CASHOUT_COPY[quote.state]}</Text>
                ) : quote?.state === 'ready' ? (
                  <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
                    {quote.method === 'instant' ? `Instant fee ${money(quote.feeCents)}. One cash-out per day.` : 'Standard payout, no fee. One cash-out per day.'}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => router.push('/payouts')}
                  style={[styles.cash, { backgroundColor: colors.track }]}
                  accessibilityRole="button"
                  accessibilityLabel="Payouts and more"
                  accessibilityHint="Navigates to payout setup and history"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={{ color: colors.title, fontWeight: '800' }}>Payouts and more</Text>
                </Pressable>
              </Card>
              <SectionLabel>Customer fare breakdown</SectionLabel>
              <Card>
                <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
                  {standard
                    ? 'No completed trips yet. The chart shows the standard split until one is on file. You keep 80%.'
                    : carpoolBonus
                      ? 'Completed trips on this account. Carpool totals are your base net plus the carpool bonus. Tips are 100% yours and shown on their own.'
                      : 'Completed trips on this account. You keep 80% of the fare. Boost is shown separately and is not in the platform fee. Tips are 100% yours and shown on their own.'}
                </Text>
                {earningsPrivate ? (
                  <SoftNote>Amounts are hidden on this phone. Turn off Make earnings private in Settings to see the split.</SoftNote>
                ) : (
                  <DonutChart segments={segments} />
                )}
                <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
                  Paid out {shownCents(Number(payouts?.paidCents) || 0, earningsPrivate)} stays in payout history.
                </Text>
              </Card>
            </>
          ) : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          {data?.apiError ? <ErrorText>{`Deposit rows: ${data.apiError}`}</ErrorText> : null}
          {data?.payoutError ? <ErrorText>{`Payout status: ${data.payoutError}`}</ErrorText> : null}
        </FadeIn>
      </ScrollView>
    </View>
  )
}

function selectedReport(
  period: DashPeriod,
  day: ReturnType<typeof reportPeriod>,
  week: ReturnType<typeof reportPeriod>,
  month: ReturnType<typeof reportPeriod>,
) {
  switch (period) {
    case 'day':
      return day
    case 'week':
      return week
    case 'month':
      return month
    default: {
      const unknown: never = period
      return unknown
    }
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: 16, paddingBottom: 40, gap: 0 },
})
