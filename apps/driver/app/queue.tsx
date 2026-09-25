import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FarePanel } from '@/components/FarePanel'
import { BackButton, Card, ErrorText, Primary, Tag } from '@/components/chrome'
import { DriverStatusCard } from '@/components/DriverStatusCard'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { oneParam } from '@/lib/oneParam'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import type { Palette } from '@/lib/palette'
import { acceptTrip, declineTrip, loadDriverDesk, subscribeTrips } from 'rides-native/driverDesk'
import { fetchDriverApplication } from 'rides-native/drivers'
import { isSyntheticOffer } from 'rides-native/syntheticOffers'
import { driverGateView } from 'rides-native/driverGateView'
import {
  formatCents,
  formatPickupAt,
  matchesQueueFilter,
  acceptActionLabel,
  declineActionLabel,
  declineDisposition,
  preferredRequestNote,
  queueEmptyCopy,
  queueFilters,
  scheduledQueueTitle,
  statusHeadline,
  tagTone,
  TESLA_FLEET_NOTICE,
  type DriverCard,
  type QueueFilter,
} from 'rides-native/tripTags'
function useQueueStyles() {
  const { colors } = useTheme()
  return useMemo(() => queueStyles(colors), [colors])
}

function QueueCard({
  card,
  busy,
  onAccept,
  onDecline,
  onOpen,
}: {
  card: DriverCard
  busy: boolean
  onAccept: () => void
  onDecline: () => void
  onOpen: () => void
}) {
  const active = card.status === 'accepted' || card.status === 'arriving'
  const preferredNote = preferredRequestNote(card)
  const styles = useQueueStyles()
  return (
    <Card>
      <Text style={styles.cardTitle}>{statusHeadline(card.status)}</Text>
      <Text style={styles.fare}>{formatCents(card.driverNetCents)} net</Text>
      <Text style={styles.copy}>{card.firstName} · {card.pickupLabel} → {card.dropoffLabel}</Text>
      {card.pickupAt ? <Text style={styles.copy}>{formatPickupAt(card.pickupAt)}</Text> : null}
      {card.passengers > 1 ? <Text style={styles.copy}>{card.passengers} riders · capacity check is your seat count</Text> : null}
      <View style={styles.tags}>
        {card.tagLabels.map((label) => (
          <Tag key={label} label={label} tone={tagTone(label)} />
        ))}
      </View>
      {preferredNote ? <Text style={styles.note}>{preferredNote}</Text> : null}
      <FarePanel card={card} />
      {card.teslaStub ? <Text style={styles.copy}>{TESLA_FLEET_NOTICE}</Text> : null}
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
            {declineActionLabel(card.status)}
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
    const nextStatus = application.application?.onboarding_status || 'none'
    const nextReason = application.application?.rejection_reason || null
    setStatus(nextStatus)
    setReason(nextReason)
    if (application.error) setError(application.error)

    const currentGate = driverGateView(nextStatus, { rejectionReason: nextReason })
    if (currentGate.canSeeOffers) {
      const desk = await loadDriverDesk(supabase, user.id)
      const merged = [...desk.offers, ...desk.scheduledOpen, ...desk.upcoming]
      const seen = new Set<string>()
      setWarning(desk.warning || null)
      setRows(merged.filter((card) => {
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
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load the queue'))
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
      pulse('accept')
      await refresh()
      if (card.status !== 'scheduled') router.push({ pathname: '/trip', params: { id: card.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept')
    } finally {
      setBusyId(null)
    }
  }

  async function onDecline(card: DriverCard) {
    if (isSyntheticOffer(card)) {
      setPassed((current) => (current.includes(card.id) ? current : [...current, card.id]))
      return
    }
    if (card.status === 'scheduled') {
      setPassed((current) => (current.includes(card.id) ? current : [...current, card.id]))
      pulse('decline')
      return
    }
    if (!supabase || !user) return
    setBusyId(card.id)
    setError(null)
    try {
      await declineTrip(supabase, card, user.id)
      pulse('decline')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not decline')
    } finally {
      setBusyId(null)
    }
  }

  const visible = rows.filter((card) => matchesQueueFilter(card, filter) && !passed.includes(card.id))
  const scheduled = visible.filter((card) => card.status === 'scheduled')
  const live = visible.filter((card) => card.status !== 'scheduled')
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
                <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filter, filter === item && styles.filterOn]}>
                  <Text style={[styles.filterText, filter === item && styles.filterTextOn]}>{filterLabel(item)}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {visible.length === 0 ? (
              <Card>
                <Text style={styles.cardTitle}>{empty.title}</Text>
                <Text style={styles.copy}>{empty.body}</Text>
              </Card>
            ) : null}
            {live.length > 0 ? <Text style={styles.section}>Open now</Text> : null}
            {live.map((card) => (
              <QueueCard key={card.id} card={card} busy={busyId === card.id} onAccept={() => onAccept(card)} onDecline={() => onDecline(card)} onOpen={() => { if (!isSyntheticOffer(card)) router.push({ pathname: '/trip', params: { id: card.id } }) }} />
            ))}
            {filter === 'weekend_party' && scheduled.length === 0 && live.length > 0 ? (
              <Card>
                <Text style={styles.cardTitle}>No scheduled weekend pickups</Text>
                <Text style={styles.copy}>Airport and campus rides booked ahead for Friday night through Sunday show up in this list.</Text>
              </Card>
            ) : null}
            {scheduled.length > 0 ? <Text style={styles.section}>{scheduledQueueTitle(filter)}</Text> : null}
            {scheduled.map((card) => (
              <QueueCard key={card.id} card={card} busy={busyId === card.id} onAccept={() => onAccept(card)} onDecline={() => onDecline(card)} onOpen={() => { if (!isSyntheticOffer(card)) router.push({ pathname: '/trip', params: { id: card.id } }) }} />
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
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  })
}
