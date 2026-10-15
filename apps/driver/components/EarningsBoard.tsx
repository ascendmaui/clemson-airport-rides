import { LinearGradient } from 'expo-linear-gradient'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { CapsuleChart } from '@/components/charts'
import { Card } from '@/components/chrome'
import { shownCents } from '@/lib/shown'
import { useTheme } from '@/lib/theme'
import type { EarningBar } from '@/lib/earningsMath'
import { formatPayoutEta } from 'rides-native/earningsDashboard.js'
import { color, radius, shadowStyle, type as typeScale } from 'rides-native/shared/theme.js'
import type {
  ForecastHighlights,
  PayoutTimeline,
  RideDetail,
  StreakBoard,
  StreakCard,
  TipsBreakdown,
} from 'rides-native/earningsDashboard.js'

export type DashPeriod = 'day' | 'week' | 'month'

const PERIODS: { id: DashPeriod; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

function periodKicker(period: DashPeriod): string {
  switch (period) {
    case 'day':
      return 'TODAY'
    case 'week':
      return 'THIS WEEK'
    case 'month':
      return 'THIS MONTH'
    default: {
      const unknown: never = period
      return unknown
    }
  }
}

function rideStatus(status: string | undefined): string {
  switch (status) {
    case 'completed':
      return 'Completed'
    case 'cancelled_wait':
      return 'No-show fee'
    case 'canceled':
      return 'Canceled'
    default:
      return 'Ride'
  }
}

function payoutStatus(status: string | null): string {
  switch (status) {
    case 'paid':
      return 'Paid'
    case 'pending':
      return 'Payout waiting'
    case 'failed':
      return 'Payout needs a retry'
    case null:
      return ''
    default:
      return status
  }
}

function useAmountColor(): string {
  const { colors, scheme } = useTheme()
  return scheme === 'dark' ? colors.orange : colors.purple
}

function whenLabel(iso: string | null): string {
  if (!iso) return 'Time not recorded'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Time not recorded'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function EarningsHero({
  period,
  amount,
  label,
  rides,
  tips,
}: {
  period: DashPeriod
  amount: string
  label: string
  rides: number
  tips: string
}) {
  const { colors, scheme } = useTheme()
  const onDark = scheme === 'dark'
  const ink = onDark ? colors.ink : color.white
  const muted = onDark ? colors.inkSecondary : 'rgba(255,255,255,0.84)'
  const body = (
    <>
      <Text style={[styles.kicker, { color: onDark ? colors.orange : '#FFD8B8' }]}>{periodKicker(period)}</Text>
      <Text style={[styles.heroAmount, { color: onDark ? colors.orange : ink }]}>{amount}</Text>
      <Text style={[styles.heroLabel, { color: muted }]}>{label}</Text>
      <Text style={[styles.heroMeta, { color: muted }]}>{rides} {rides === 1 ? 'ride' : 'rides'} · {tips} in tips</Text>
    </>
  )
  if (scheme === 'dark') {
    return (
      <View style={[styles.hero, styles.heroDark, { backgroundColor: colors.elevated, borderColor: colors.orange }]}>
        {body}
      </View>
    )
  }
  return (
    <LinearGradient colors={[color.purple, '#3C1E66']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
      {body}
    </LinearGradient>
  )
}

export function PeriodCharts({
  selected,
  onSelect,
  totals,
  bars,
  caption,
  split,
  hidden,
}: {
  selected: DashPeriod
  onSelect: (period: DashPeriod) => void
  totals: Record<DashPeriod, string>
  bars: EarningBar[]
  caption: string
  split: string
  hidden: boolean
}) {
  const { colors, scheme } = useTheme()
  return (
    <Card>
      <View style={styles.periodRow}>
        {PERIODS.map((item) => {
          const on = item.id === selected
          const tileInk = on ? colors.onAccent : colors.ink
          const tileMuted = on ? 'rgba(255,255,255,0.82)' : colors.inkSecondary
          return (
            <Pressable
              key={item.id}
              onPress={() => onSelect(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`${item.label} earnings chart, ${totals[item.id]}`}
              accessibilityState={{ selected: on }}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              style={[
                styles.periodTile,
                {
                  backgroundColor: on ? colors.purple : (scheme === 'dark' ? colors.elevated : colors.track),
                  borderColor: on ? colors.orange : 'transparent',
                },
              ]}
            >
              <Text style={[styles.periodName, { color: tileMuted }]}>{item.label}</Text>
              <Text style={[styles.periodAmount, { color: tileInk }]} numberOfLines={1}>{totals[item.id]}</Text>
            </Pressable>
          )
        })}
      </View>
      <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{caption}</Text>
      <Text style={{ color: colors.ink, fontWeight: '700' }}>{split}</Text>
      {hidden ? (
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>The chart is hidden while earnings are private on this phone.</Text>
      ) : (
        <CapsuleChart bars={bars} formatValue={(cents) => shownCents(cents, false)} />
      )}
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme()
  const amountColor = useAmountColor()
  return (
    <View style={[styles.stat, { backgroundColor: colors.track }]}>
      <Text style={[styles.statLabel, { color: amountColor }]}>{label}</Text>
      <Text style={[styles.statValue, { color: colors.ink }]}>{value}</Text>
    </View>
  )
}

export function TipsCard({ tips, money }: { tips: TipsBreakdown; money: (cents: number) => string }) {
  const { colors } = useTheme()
  const amountColor = useAmountColor()
  const share = Math.round(tips.shareOfTake * 100)
  return (
    <Card accessibilityLabel="Tips breakdown">
      <Text style={[styles.cardTitle, { color: colors.title }]}>Tips</Text>
      <View style={styles.statRow}>
        <Stat label="TOTAL" value={money(tips.tipCents)} />
        <Stat label="RIDES" value={String(tips.tippedRides)} />
        <Stat label="AVERAGE" value={money(tips.averageTipCents)} />
      </View>
      <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
        {tips.tippedRides
          ? `${tips.tippedRides} of ${tips.completedRides} completed rides in this period included a tip. Tips are ${share}% of take.`
          : 'No tips in this period. Tips land here when a rider adds one after the ride.'}
      </Text>
      {tips.rides.slice(0, 4).map((ride) => (
        <View key={ride.tripId} style={[styles.line, { borderTopColor: colors.border }]}>
          <Text style={{ color: colors.ink, fontWeight: '700', flex: 1 }} numberOfLines={1}>{ride.label}</Text>
          <Text style={{ color: amountColor, fontWeight: '800' }}>{money(ride.tipCents)}</Text>
        </View>
      ))}
    </Card>
  )
}

function StreakRow({ card, money }: { card: StreakCard; money: (cents: number) => string }) {
  const { colors } = useTheme()
  const amountColor = useAmountColor()
  const width = `${Math.round(card.progress * 100)}%` as `${number}%`
  return (
    <View
      accessible
      accessibilityLabel={`${card.title}, ${card.current} of ${card.target}. ${card.toNext} more ${card.unit} for ${money(card.bonusCents)}`}
      style={{ gap: 6 }}
    >
      <View style={styles.lineTight}>
        <Text style={{ color: colors.title, fontWeight: '800' }}>{card.title}</Text>
        <Text style={{ color: amountColor, fontWeight: '800' }}>{card.current}/{card.target}</Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.track }]}>
        <View style={[styles.fill, { backgroundColor: colors.orange, width }]} />
      </View>
      <Text style={{ color: colors.inkSecondary }}>{card.toNext} more {card.unit} for {money(card.bonusCents)}</Text>
    </View>
  )
}

export function StreakCardView({
  board,
  note,
  money,
}: {
  board: StreakBoard
  note: string | null
  money: (cents: number) => string
}) {
  const { colors } = useTheme()
  const amountColor = useAmountColor()
  return (
    <Card accessibilityLabel="Streak and bonus progress">
      <Text style={[styles.cardTitle, { color: colors.title }]}>Streaks</Text>
      {note ? <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{note}</Text> : null}
      {!note && !board.available ? (
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>Streaks and bonuses are unavailable right now.</Text>
      ) : null}
      {board.cards.map((card) => <StreakRow key={card.id} card={card} money={money} />)}
      {!note && board.available && board.cards.length === 0 ? (
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>Streak bonuses are turned off.</Text>
      ) : null}
      {board.bonuses.length ? (
        <View style={{ gap: 8 }}>
          <Text style={[styles.subhead, { color: colors.link }]}>Bonuses</Text>
          {board.bonuses.slice(0, 4).map((bonus) => (
            <View key={`${bonus.kind}-${bonus.at}`} style={styles.lineTight}>
              <Text style={{ color: colors.ink, fontWeight: '700', flex: 1 }}>{bonus.label}</Text>
              <Text style={{ color: amountColor, fontWeight: '800' }}>{money(bonus.amountCents)} · {bonus.status}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  )
}

export function ForecastPanel({
  forecast,
  note,
  money,
}: {
  forecast: ForecastHighlights
  note: string | null
  money: (cents: number) => string
}) {
  const { colors, scheme } = useTheme()
  const amountColor = useAmountColor()
  return (
    <Card accessibilityLabel="Best hours and zones, estimate">
      <View style={styles.lineTight}>
        <Text style={[styles.cardTitle, { color: colors.title }]}>Best hours</Text>
        <View style={[styles.estimate, { backgroundColor: scheme === 'dark' ? colors.track : colors.orangeSoft }]}>
          <Text style={{ color: amountColor, fontWeight: '800', fontSize: 11 }}>ESTIMATE</Text>
        </View>
      </View>
      {note ? <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{note}</Text> : null}
      {!note && forecast.disclaimer ? <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{forecast.disclaimer}</Text> : null}
      {forecast.eventsNote ? <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{forecast.eventsNote}</Text> : null}
      {!note && forecast.available && forecast.hours.length === 0 ? (
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>No hours are ranked for the next week yet.</Text>
      ) : null}
      {forecast.hours.map((hour) => (
        <View key={`${hour.zone}-${hour.startsAt}`} style={[styles.line, { borderTopColor: colors.border }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.ink, fontWeight: '800' }}>{hour.window}</Text>
            <Text style={{ color: colors.inkSecondary }}>{hour.zoneLabel} · {hour.confidence}</Text>
          </View>
          <Text style={{ color: amountColor, fontWeight: '800' }}>~{money(hour.expectedCentsPerHour)}/hr</Text>
        </View>
      ))}
      {forecast.zones.length ? (
        <View style={{ gap: 8 }}>
          <Text style={[styles.subhead, { color: colors.link }]}>Zones</Text>
          {forecast.zones.map((zone) => (
            <View key={zone.zone || zone.zoneLabel} style={[styles.zone, { backgroundColor: scheme === 'dark' ? colors.elevated : colors.purpleSoft }]}>
              <Text style={{ color: colors.title, fontWeight: '800', flex: 1 }}>{zone.zoneLabel}</Text>
              <Text style={{ color: amountColor, fontWeight: '800' }}>~{money(zone.expectedCentsPerHour)}/hr</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  )
}

export function PayoutPanel({
  timeline,
  money,
  onOpen,
}: {
  timeline: PayoutTimeline
  money: (cents: number) => string
  onOpen: () => void
}) {
  const { colors } = useTheme()
  const amountColor = useAmountColor()
  const eta = formatPayoutEta(timeline.etaAt)
  return (
    <Card accessibilityLabel="Payout history and next payout">
      <Text style={[styles.kicker, { color: amountColor }]}>NEXT PAYOUT</Text>
      <Text style={[styles.eta, { color: amountColor }]}>
        {eta || 'Nothing waiting'}
      </Text>
      <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
        {timeline.waitingCents > 0
          ? `${money(timeline.waitingCents)} is waiting. Transfers run on the daily payout, after any retry time.`
          : 'Nothing is waiting to pay out. Completed rides land here after Stripe records them.'}
      </Text>
      <Text style={{ color: colors.inkSecondary }}>Paid out {money(timeline.paidCents)}</Text>
      {timeline.history.length ? <Text style={[styles.subhead, { color: colors.link }]}>Payout history</Text> : null}
      {timeline.history.slice(0, 6).map((row) => (
        <View key={row.id} style={[styles.line, { borderTopColor: colors.border }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.ink, fontWeight: '700' }} numberOfLines={1}>{row.label}</Text>
            <Text style={{ color: colors.inkSecondary }}>{row.status}{row.at ? ` · ${whenLabel(row.at)}` : ''}</Text>
            {row.lastError ? <Text style={{ color: colors.danger }}>{row.lastError}</Text> : null}
          </View>
          <Text style={{ color: amountColor, fontWeight: '800' }}>{money(row.amountCents)}</Text>
        </View>
      ))}
      <Pressable
        onPress={onOpen}
        style={[styles.cash, { backgroundColor: colors.orange }]}
        accessibilityRole="button"
        accessibilityLabel="Cash out and payout history"
        accessibilityHint="Opens payouts to retry a transfer that is already due"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={[styles.cashLabel, { color: '#1A1033' }]}>Cash out</Text>
      </Pressable>
    </Card>
  )
}

function rideExtras(ride: RideDetail, money: (cents: number) => string): string {
  const parts: string[] = []
  if (ride.tipCents > 0) parts.push(`Tip ${money(ride.tipCents)}`)
  if (ride.carpoolBonusCents > 0) parts.push(`Carpool bonus ${money(ride.carpoolBonusCents)}`)
  if (ride.boostCents > 0) parts.push(`Boost ${money(ride.boostCents)}`)
  const status = payoutStatus(ride.payoutStatus)
  if (status) parts.push(status)
  return parts.join(' · ')
}

export function RideList({
  rides,
  money,
  onOpen,
}: {
  rides: RideDetail[]
  money: (cents: number) => string
  onOpen: (id: string) => void
}) {
  const { colors } = useTheme()
  const amountColor = useAmountColor()
  return (
    <Card accessibilityLabel="Per-ride earnings">
      <Text style={[styles.cardTitle, { color: colors.title }]}>Rides</Text>
      {rides.length === 0 ? (
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>No paid rides in this period yet.</Text>
      ) : null}
      {rides.slice(0, 8).map((ride) => {
        const extras = rideExtras(ride, money)
        return (
          <Pressable
            key={ride.id}
            onPress={() => onOpen(ride.id)}
            accessibilityRole="button"
            accessibilityLabel={`${ride.pickup} to ${ride.dropoff}, ${money(ride.payoutCents)}${extras ? `, ${extras}` : ''}`}
            accessibilityHint="Opens this ride"
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            style={[styles.ride, { borderTopColor: colors.border }]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.ink, fontWeight: '800' }} numberOfLines={1}>{ride.pickup} → {ride.dropoff}</Text>
              <Text style={{ color: colors.inkSecondary }}>{whenLabel(ride.at)} · {rideStatus(ride.status)}</Text>
              {extras ? <Text style={{ color: colors.inkSecondary }}>{extras}</Text> : null}
            </View>
            <Text style={{ color: amountColor, fontWeight: '800' }}>{money(ride.payoutCents)}</Text>
          </Pressable>
        )
      })}
    </Card>
  )
}

export function LinkRow({ label, hint, onPress }: { label: string; hint: string; onPress: () => void }) {
  const { colors, scheme } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[styles.link, { backgroundColor: scheme === 'dark' ? colors.elevated : colors.card, borderColor: colors.border }]}
    >
      <Text style={{ color: colors.link, fontWeight: '800' }}>{label}</Text>
      <Text style={{ color: colors.link, fontWeight: '800' }}>›</Text>
    </Pressable>
  )
}

export function BoardNote({ children }: { children: ReactNode }) {
  const { colors } = useTheme()
  return <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{children}</Text>
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: radius.sheet,
    paddingHorizontal: 22,
    paddingVertical: 22,
    gap: 4,
    ...shadowStyle(color.purple, 'float'),
  },
  heroDark: {
    borderWidth: 1,
  },
  kicker: { ...typeScale.kicker },
  heroAmount: { fontSize: 48, fontWeight: '800', letterSpacing: -1.4 },
  heroLabel: { fontSize: 16, fontWeight: '700' },
  heroMeta: { fontSize: 14, fontWeight: '600', marginTop: 6 },
  periodRow: { flexDirection: 'row', gap: 8 },
  periodTile: {
    flex: 1,
    minHeight: 64,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 2,
  },
  periodName: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  periodAmount: { fontSize: 16, fontWeight: '800' },
  cardTitle: { ...typeScale.headline },
  statRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, borderRadius: radius.lg, paddingHorizontal: 10, paddingVertical: 10, gap: 4, minHeight: 64 },
  statLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  statValue: { fontSize: 16, fontWeight: '800' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  lineTight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  track: { height: 6, borderRadius: 999, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 999 },
  subhead: { fontWeight: '800', marginTop: 4 },
  estimate: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  zone: { borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  eta: { fontSize: 28, fontWeight: '800', letterSpacing: -0.4 },
  cash: { borderRadius: radius.lg, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  cashLabel: { ...typeScale.button, fontWeight: '800' },
  ride: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, minHeight: 64 },
  link: {
    minHeight: 52,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
})
