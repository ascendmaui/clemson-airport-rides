import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
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
