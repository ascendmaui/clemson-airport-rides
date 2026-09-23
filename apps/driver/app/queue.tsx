import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BackButton, Card, ErrorText, Primary, Tag } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { acceptTrip, loadDriverDesk, subscribeTrips } from 'rides-native/driverDesk'
import {
  formatCents,
  formatPickupAt,
  matchesQueueFilter,
  queueFilters,
  statusHeadline,
  TESLA_FLEET_NOTICE,
  type DriverCard,
  type QueueFilter,
} from 'rides-native/tripTags'
import { INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'

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
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const [rows, setRows] = useState<DriverCard[]>([])
  const [filter, setFilter] = useState<QueueFilter>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const desk = await loadDriverDesk(supabase, user.id)
    const merged = [...desk.offers, ...desk.scheduledOpen, ...desk.upcoming]
    const seen = new Set<string>()
    setWarning(desk.warning || null)
    setRows(merged.filter((card) => {
      if (seen.has(card.id)) return false
      seen.add(card.id)
      return true
    }))
  }, [user])

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load the queue'))
  }, [refresh])

  useEffect(() => {
    if (!supabase || !user) return undefined
    return subscribeTrips(supabase, () => {
      refresh().catch(() => {})
    })
  }, [refresh, user])

  async function onAccept(card: DriverCard) {
    if (!user || !supabase) return
    setBusyId(card.id)
    setError(null)
    try {
      await acceptTrip(supabase, card, user.id)
      await refresh()
      if (card.status !== 'scheduled') router.push({ pathname: '/trip', params: { id: card.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept')
    } finally {
      setBusyId(null)
    }
  }

  const visible = rows.filter((card) => matchesQueueFilter(card, filter))

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <ScrollView contentContainerStyle={styles.list}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.kicker}>QUEUE</Text>
        <Text style={styles.title}>Accept rides</Text>
        <Text style={styles.copy}>
          Chosen-driver requests, open matches, student discounts, game-day rides, and scheduled weekend or party pickups.
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {queueFilters().map((item) => (
            <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filter, filter === item && styles.filterOn]}>
              <Text style={[styles.filterText, filter === item && styles.filterTextOn]}>{filterLabel(item)}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {warning ? <ErrorText>{warning}</ErrorText> : null}
        {!user ? <Primary label="Sign in" onPress={() => router.push('/sign-in')} /> : null}
        {user && visible.length === 0 ? (
          <Card>
            <Text style={styles.cardTitle}>Nothing in this filter</Text>
            <Text style={styles.copy}>New requests show up here while you are approved. Go online so riders can choose you.</Text>
          </Card>
        ) : null}
        {visible.map((card) => (
          <Card key={card.id}>
            <Text style={styles.cardTitle}>{statusHeadline(card.status)}</Text>
            <Text style={styles.fare}>{formatCents(card.driverNetCents)} net</Text>
            <Text style={styles.copy}>{card.firstName} · {card.pickupLabel} → {card.dropoffLabel}</Text>
            {card.pickupAt ? <Text style={styles.copy}>{formatPickupAt(card.pickupAt)}</Text> : null}
            {card.depositCents > 0 ? <Text style={styles.copy}>25% deposit · {formatCents(card.depositCents)}</Text> : null}
            <View style={styles.tags}>
              {card.tagLabels.map((label) => <Tag key={label} label={label} />)}
            </View>
            {card.teslaStub ? <Text style={styles.copy}>{TESLA_FLEET_NOTICE}</Text> : null}
            {card.status === 'accepted' || card.status === 'arriving' ? (
              <Primary label="Open live trip" onPress={() => router.push({ pathname: '/trip', params: { id: card.id } })} tone="purple" />
            ) : (
              <Primary label={busyId === card.id ? 'Saving…' : 'Accept'} onPress={() => onAccept(card)} disabled={busyId === card.id} />
            )}
          </Card>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  list: { padding: 16, gap: 12, paddingBottom: 40 },
  kicker: { color: ORANGE, fontWeight: '800', letterSpacing: 1.1, fontSize: 12, marginTop: 8 },
  title: { fontSize: 28, fontWeight: '800', color: PURPLE },
  copy: { color: INK_SECONDARY, fontSize: 14, lineHeight: 20 },
  filters: { gap: 8 },
  filter: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  filterOn: { backgroundColor: PURPLE },
  filterText: { color: PURPLE, fontWeight: '800' },
  filterTextOn: { color: '#fff' },
  cardTitle: { color: PURPLE, fontWeight: '800', fontSize: 18 },
  fare: { color: INK, fontWeight: '800', fontSize: 22 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
})
