import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FarePanel } from '@/components/FarePanel'
import { BackButton, Card, ErrorText, Primary, Tag } from '@/components/chrome'
import { DriverStatusCard } from '@/components/DriverStatusCard'
import { useAuth } from '@/lib/auth'
import { notifyAcceptedRide } from '@/lib/push'
import { useFeedback } from '@/lib/feedback'
import { oneParam } from '@/lib/oneParam'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import type { Palette } from '@/lib/palette'
import { acceptTrip, confirmBackupQueueTrip, declineDriverOffer, loadDriverDesk, markSearchingOffers, releaseBackupQueueSeat, subscribeTrips } from 'rides-native/driverDesk'
import { fetchDriverApplication } from 'rides-native/drivers'
import { isSyntheticOffer } from 'rides-native/syntheticOffers'
import { driverGateView } from 'rides-native/driverGateView'
import {
  confirmCountdownLabel,
  leaveNowCountdownLabel,
  formatCents,
  formatPickupAt,
  matchesQueueFilter,
  acceptActionLabel,
  declineActionLabel,
  declineDisposition,
  preferredRequestNote,
  queueEmptyCopy,
  queueFilters,
  statusHeadline,
  tagTone,
  COMFORT_FLEET_NOTICE,
  type DriverCard,
  type QueueFilter,
} from 'rides-native/tripTags'
import { formatHourlyRate, ladderOfferNet, offerHourly } from 'rides-native/offerLadder.js'
import { ScheduledRidesExplainer, ScheduledRidesHint } from 'rides-native/ScheduledRidesInfo'
import { driverBoostOfferLine } from '../../../shared/copy/boost.js'
import { compareBoostedFirst, formatBoostBadge } from '../../../shared/scheduledBoost.js'

function useQueueStyles() {
  const { colors } = useTheme()
  return useMemo(() => queueStyles(colors), [colors])
}

function ConfirmCountdown({ closesAt }: { closesAt?: string | null }) {
  const [label, setLabel] = useState<string | null>(() => confirmCountdownLabel(closesAt))
  useEffect(() => {
    const tick = () => setLabel(confirmCountdownLabel(closesAt))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [closesAt])
  if (!label) return null
  return <Text style={{ color: '#F56600', fontWeight: '800', fontSize: 22, marginTop: 4 }}>{label}</Text>
}

function LeaveNowCountdown({ leaveNowAt, onDue }: { leaveNowAt?: string | null; onDue: () => void }) {
  const fired = useRef(false)
  const onDueRef = useRef(onDue)
  onDueRef.current = onDue
  const [label, setLabel] = useState<string | null>(() => leaveNowCountdownLabel(leaveNowAt))
  useEffect(() => {
    fired.current = false
  }, [leaveNowAt])
  useEffect(() => {
    const tick = () => {
      const next = leaveNowCountdownLabel(leaveNowAt)
      setLabel(next)
      if (next === 'Leave now' && !fired.current) {
        fired.current = true
        onDueRef.current()
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [leaveNowAt])
  if (!label) return null
  return <Text style={{ color: '#F56600', fontWeight: '800', fontSize: 22, marginTop: 4 }}>{label}</Text>
}

function seatReleaseLabel(role?: string | null) {
  if (role === 'backup') return 'Leave backup seat'
  if (role === 'primary') return 'Can\'t make this trip'
  return null
}

function QueueCard({
  card,
  busy,
  onAccept,
  onDecline,
  onOpen,
  onConfirm,
  onDepart,
}: {
  card: DriverCard
  busy: boolean
  onAccept: () => void | Promise<void>
  onDecline: () => void | Promise<void>
  onOpen: () => void
  onConfirm: () => void | Promise<void>
  onDepart: () => void | Promise<void>
  key?: string
}) {
  const active = card.status === 'accepted' || card.status === 'arriving'
  const preferredNote = preferredRequestNote(card)
  const styles = useQueueStyles()
  const { colors } = useTheme()
  const ladder = ladderOfferNet(card)
  const hourly = formatHourlyRate(offerHourly(card).hourlyCents)
  return (
    <Card>
      <View style={styles.riderRow}>
        {card.riderAvatarUrl ? (
          <Image
            source={{ uri: card.riderAvatarUrl }}
            style={styles.avatar}
            accessibilityIgnoresInvertColors
            accessibilityLabel={`${card.firstName || 'Rider'} profile photo`}
          />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarLetter}>{(card.firstName || 'R').slice(0, 1)}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{card.firstName}</Text>
          <Text style={styles.copy}>{statusHeadline(card.status)}</Text>
        </View>
      </View>
      <Text style={[styles.fare, (card.boostDriverCents || 0) > 0 && { color: '#F56600' }]}>{formatCents(card.driverNetCents)} est. earnings</Text>
      {(card.boostDriverCents || 0) > 0 ? (
        <View style={styles.boostBadge}>
          <Text style={styles.boostText}>{formatBoostBadge(card.boostDriverCents || 0)}</Text>
        </View>
      ) : null}
      {(card.boostDriverCents || 0) > 0 ? (
        <Text style={styles.copy}>{driverBoostOfferLine(card.boostDriverCents || 0)}</Text>
      ) : null}
      <Text style={styles.note}>{ladder?.subtext || 'You net 80%'}</Text>
      <Text style={styles.copy}>{hourly}</Text>
      <Text style={styles.copy}>Pickup · {card.pickupLabel}</Text>
      <Text style={styles.copy}>Drop-off · {card.dropoffLabel}</Text>
      {card.pickupAt ? <Text style={styles.copy}>{formatPickupAt(card.pickupAt)}</Text> : null}
      {card.backupLabel ? <Text style={[styles.note, { color: '#F56600', fontWeight: '800' }]}>{card.backupLabel}</Text> : null}
      {card.lookingForBackup && card.backupRole === 'primary' ? <Text style={[styles.note, { color: '#522D80' }]}>Looking for backup driver</Text> : null}
      {card.lookingForBackup && card.backupRole === 'primary' ? <ScheduledRidesHint topic="looking" colors={colors} /> : null}
      {card.backupRole === 'open_backup' ? <ScheduledRidesHint topic="offer" colors={colors} /> : null}
      {card.backupRole === 'backup' && card.pickupAt ? (
        <Text style={[styles.note, { color: '#522D80' }]}>{`You're #2 for this trip, pickup at ${formatPickupAt(card.pickupAt)}`}</Text>
      ) : null}
      {card.backupStatusLine && card.backupRole === 'primary' ? <Text style={styles.note}>{card.backupStatusLine}</Text> : null}
      {card.backupNotice ? <Text style={[styles.note, { color: '#522D80', fontWeight: '700' }]}>{card.backupNotice}</Text> : null}
      {card.passengers > 1 ? <Text style={styles.copy}>{card.passengers} riders · capacity check is your seat count</Text> : null}
      <View style={styles.tags}>
        {card.tagLabels.map((label: string) => (
          <Tag key={label} label={label} tone={tagTone(label)} />
        ))}
      </View>
      {preferredNote ? <Text style={styles.note}>{preferredNote}</Text> : null}
      <FarePanel card={card} />
      {card.comfortStub ? <Text style={styles.copy}>{COMFORT_FLEET_NOTICE}</Text> : null}
      {card.backupConfirmOpen ? (
        <View style={{ marginTop: 8, padding: 10, borderRadius: 12, backgroundColor: 'rgba(245,102,0,0.12)' }}>
          <Text style={{ color: '#F56600', fontWeight: '800' }}>Confirm trip</Text>
          <Text style={styles.copy}>{card.backupConfirmCopy}</Text>
          <ScheduledRidesHint topic="confirm" colors={colors} />
          {card.backupUrgent ? <Text style={[styles.note, { color: '#F56600', fontWeight: '800' }]}>You are up. Confirm and start toward pickup.</Text> : null}
          <ConfirmCountdown closesAt={card.backupConfirmClosesAt} />
          <Primary label={busy ? 'Saving…' : 'Confirm trip'} onPress={onConfirm} disabled={busy} />
        </View>
      ) : null}
      {card.backupLeaveNowOpen ? (
        <View style={{ marginTop: 8, padding: 10, borderRadius: 12, backgroundColor: 'rgba(245,102,0,0.12)' }}>
          <Text style={{ color: '#F56600', fontWeight: '800' }}>Leave now</Text>
          <ScheduledRidesHint topic="leave" colors={colors} />
          <LeaveNowCountdown leaveNowAt={card.backupLeaveNowAt} onDue={onDepart} />
        </View>
      ) : null}
      {active ? (
        <Primary label="Open live trip" onPress={onOpen} tone="purple" />
      ) : (
        <Primary label={busy ? 'Saving…' : acceptActionLabel(card.status)} onPress={onAccept} disabled={busy} />
      )}
      {!active ? (
        <Pressable
          onPress={onDecline}
          disabled={busy}
          style={styles.decline}
          accessibilityRole="button"
          accessibilityLabel={declineActionLabel(card.status)}
          accessibilityState={{ disabled: busy }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[styles.declineText, declineDisposition(card.status) === 'cancel' && styles.declineCancel]}>
            {seatReleaseLabel(card.backupRole) || declineActionLabel(card.status)}
          </Text>
        </Pressable>
      ) : null}
    </Card>
  )
}

function filterLabel(filter: QueueFilter): string {
  switch (filter) {
    case 'all':
      return 'All'
    case 'student':
      return 'Student'
    case 'game_day':
      return 'Game day'
    case 'weekend_party':
      return 'Weekend'
    default: {
      const unknown: never = filter
      return unknown
    }
  }
}

export default function QueueScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ filter?: string }>()
  const insets = useSafeAreaInsets()
  const styles = useQueueStyles()
  const { colors } = useTheme()
  const { user } = useAuth()
  const { pulse } = useFeedback()
  const [passed, setPassed] = useState<string[]>([])
  const [rows, setRows] = useState<DriverCard[]>([])
  const [filter, setFilter] = useState<QueueFilter>('all')
  const [board, setBoard] = useState<'open' | 'scheduled'>('open')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [status, setStatus] = useState('none')
  const [reason, setReason] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const gate = useMemo(
    () => driverGateView(status, { rejectionReason: reason }),
    [status, reason]
  )
  const canSeeOffers = gate.canSeeOffers

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const application = await fetchDriverApplication(supabase, user.id)
    if (application.error) {
      setError(application.error)
      return
    }
    const nextStatus = application.application?.onboarding_status || 'none'
    const nextReason = application.application?.rejection_reason || null
    setStatus(nextStatus)
    setReason(nextReason)

    const currentGate = driverGateView(nextStatus, { rejectionReason: nextReason })
    if (currentGate.canSeeOffers) {
      const desk = await loadDriverDesk(supabase, user.id)
      if (desk.online) markSearchingOffers(supabase, desk.offers).catch(() => {})
      const merged = [...desk.offers, ...desk.scheduledOpen, ...desk.upcoming]
      const seen = new Set<string>()
      setWarning(desk.warning || null)
      setRows(merged.filter((card: DriverCard) => {
        if (seen.has(card.id)) return false
        seen.add(card.id)
        return true
      }))
    } else {
      setRows([])
      setWarning(null)
    }
  }, [user])

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh the queue')
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load the queue'))
  }, [refresh])

  useEffect(() => {
    const requested = oneParam(params.filter)
    if (queueFilters().includes(requested as QueueFilter)) setFilter(requested as QueueFilter)
  }, [params.filter])

  useEffect(() => {
    if (!supabase || !user || !canSeeOffers) return undefined
    return subscribeTrips(supabase, () => {
      refresh().catch(() => {})
    })
  }, [canSeeOffers, refresh, user])

  async function onAccept(card: DriverCard) {
    if (!user || !supabase) return
    setBusyId(card.id)
    setError(null)
    try {
      await acceptTrip(supabase, card, user.id)
      notifyAcceptedRide(card).catch(() => {})
      pulse('accept')
      await refresh()
      if (card.status !== 'scheduled') router.push({ pathname: '/trip', params: { id: card.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept')
    } finally {
      setBusyId(null)
    }
  }

  async function onDepart(card: DriverCard) {
    if (!supabase) return
    setBusyId(card.id)
    setError(null)
    try {
      await confirmBackupQueueTrip(supabase, card.id, { navigate: true })
      pulse('accept')
      await refresh()
      router.push({ pathname: '/trip', params: { id: card.id } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not start navigation'
      if (/changed|Refresh/i.test(message)) {
        router.push({ pathname: '/trip', params: { id: card.id } })
      } else {
        setError(message)
      }
    } finally {
      setBusyId(null)
    }
  }

  async function onConfirm(card: DriverCard) {
    if (!supabase) return
    setBusyId(card.id)
    setError(null)
    try {
      await confirmBackupQueueTrip(supabase, card.id)
      pulse('accept')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm')
    } finally {
      setBusyId(null)
    }
  }

  async function onDecline(card: DriverCard) {
    if (isSyntheticOffer(card)) {
      setPassed((current: string[]) => (current.includes(card.id) ? current : [...current, card.id]))
      return
    }
    if (card.status === 'scheduled') {
      if ((card.backupRole === 'primary' || card.backupRole === 'backup') && supabase) {
        setBusyId(card.id)
        setError(null)
        try {
          await releaseBackupQueueSeat(supabase, card.id, { role: card.backupRole })
          pulse('decline')
          await refresh()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not release this seat')
        } finally {
          setBusyId(null)
        }
        return
      }
      setPassed((current: string[]) => (current.includes(card.id) ? current : [...current, card.id]))
      pulse('decline')
      return
    }
    if (!supabase || !user) return
    setBusyId(card.id)
    setError(null)
    try {
      await declineDriverOffer(supabase, card, user.id)
      pulse('decline')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not decline')
    } finally {
      setBusyId(null)
    }
  }

  const visible = rows.filter((card: DriverCard) => matchesQueueFilter(card, filter) && !passed.includes(card.id))
  const scheduled = visible
    .filter((card: DriverCard) => card.status === 'scheduled' || card.offerPhase === 'scheduled')
    .slice()
    .sort(compareBoostedFirst)
  const live = visible.filter((card: DriverCard) => card.status !== 'scheduled' && card.offerPhase !== 'scheduled')
  const shown = board === 'scheduled' ? scheduled : live
  const empty = queueEmptyCopy(filter)

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            tintColor={colors.orange}
            title="Checking application status…"
            titleColor={colors.inkSecondary}
            accessibilityLabel="Pull to refresh application status"
          />
        }
      >
        <BackButton onPress={() => router.back()} />
        <Text style={styles.kicker}>QUEUE</Text>
        <Text style={styles.title}>{canSeeOffers ? 'Accept rides' : 'Ride queue'}</Text>
        <Text style={styles.copy}>
          {canSeeOffers
            ? 'Chosen-driver requests, open matches, student discounts, game-day rides, and scheduled weekend or party pickups.'
            : 'Ride requests and scheduled pickups will appear here once your driver application is approved.'}
        </Text>

        <View style={[styles.filters, styles.board]}>
          {([
            ['open', 'Open pool'],
            ['scheduled', 'Scheduled'],
          ] as const).map(([id, label]) => (
            <Pressable
              key={id}
              onPress={() => setBoard(id)}
              style={[styles.filter, board === id && styles.filterOn]}
              accessibilityRole="tab"
              accessibilityLabel={id === 'scheduled' ? 'Scheduled rides at 75 percent' : 'Open pool'}
              accessibilityState={{ selected: board === id }}
            >
              <Text style={[styles.filterText, board === id && styles.filterTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.copy}>
          {board === 'scheduled'
            ? 'Scheduled rides stay on this tab. You net 75%.'
            : 'The first offer nets 80% for 15 seconds, then the pool nets 70% for two minutes.'}
        </Text>
        {board === 'scheduled' ? <ScheduledRidesExplainer role="driver" colors={colors} /> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {queueFilters().map((item) => (
            <Pressable
              key={item}
              onPress={() => setFilter(item)}
              style={[styles.filter, filter === item && styles.filterOn]}
              accessibilityRole="tab"
              accessibilityLabel={`${filterLabel(item)} filter`}
              accessibilityState={{ selected: filter === item }}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            >
              <Text style={[styles.filterText, filter === item && styles.filterTextOn]}>{filterLabel(item)}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {warning ? <ErrorText>{warning}</ErrorText> : null}
        {!user ? <Primary label="Sign in" onPress={() => router.push('/sign-in')} /> : null}

        {!canSeeOffers ? (
          <DriverStatusCard
            status={status}
            gate={gate}
            reason={reason}
            onRefresh={onPullRefresh}
            refreshing={refreshing}
          />
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
              {queueFilters().map((item) => (
                <Pressable
                  key={item}
                  onPress={() => setFilter(item)}
                  style={[styles.filter, filter === item && styles.filterOn]}
                  accessibilityRole="button"
                  accessibilityLabel={filterLabel(item)}
                  accessibilityState={{ selected: filter === item }}
                >
                  <Text style={[styles.filterText, filter === item && styles.filterTextOn]}>{filterLabel(item)}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {shown.length === 0 ? (
              <Card>
                <Text style={styles.cardTitle}>{board === 'scheduled' ? 'No scheduled rides' : empty.title}</Text>
                <Text style={styles.copy}>
                  {board === 'scheduled'
                    ? 'Rides booked ahead show up on this tab at 75%.'
                    : empty.body}
                </Text>
              </Card>
            ) : null}
            {shown.map((card: DriverCard) => (
              <QueueCard key={card.id} card={card} busy={busyId === card.id} onAccept={() => onAccept(card)} onDecline={() => onDecline(card)} onConfirm={() => onConfirm(card)} onDepart={() => onDepart(card)} onOpen={() => { if (!isSyntheticOffer(card)) router.push({ pathname: '/trip', params: { id: card.id } }) }} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function queueStyles(colors: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    list: { padding: 16, gap: 12, paddingBottom: 40 },
    kicker: { color: colors.orange, fontWeight: '800', letterSpacing: 1.1, fontSize: 12, marginTop: 8 },
    title: { fontSize: 28, fontWeight: '800', color: colors.title },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    note: { color: colors.orange, fontSize: 13, lineHeight: 18, fontWeight: '700' },
    filters: { gap: 8 },
    board: { flexDirection: 'row' },
    riderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    avatar: { width: 44, height: 44, borderRadius: 22 },
    avatarFallback: { backgroundColor: colors.purple, alignItems: 'center', justifyContent: 'center' },
    avatarLetter: { color: '#fff', fontWeight: '800', fontSize: 18 },
    filter: { backgroundColor: colors.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    filterOn: { backgroundColor: colors.fill },
    filterText: { color: colors.title, fontWeight: '800' },
    filterTextOn: { color: colors.onAccent },
    section: { color: colors.title, fontWeight: '800', marginTop: 4 },
    cardTitle: { color: colors.title, fontWeight: '800', fontSize: 18 },
    decline: { alignItems: 'center', paddingVertical: 4 },
    declineText: { color: colors.inkSecondary, fontWeight: '700' },
    declineCancel: { color: colors.orange },
    fare: { color: colors.ink, fontWeight: '800', fontSize: 22 },
    boostBadge: {
      alignSelf: 'flex-start',
      backgroundColor: '#F56600',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    boostText: { color: '#fff', fontWeight: '800', fontSize: 12 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  })
}
