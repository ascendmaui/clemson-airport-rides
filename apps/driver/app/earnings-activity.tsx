import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { shownCents } from '@/lib/shown'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { messagingGuide } from '../../../shared/copy/messaging.js'
import { loadEarnings } from 'rides-native/driverDesk'
import { carpoolPayFromTrip, incentiveLabel, tripPayoutCents } from 'rides-native/tripTags'
import { formatBoostBadge, readBoostCents } from '../../../shared/scheduledBoost.js'

type Trip = Awaited<ReturnType<typeof loadEarnings>>['trips'][number]
type Filter = 'all' | 'completed' | 'canceled'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Trips' },
  { id: 'canceled', label: 'Canceled' },
]

function filterLabel(filter: Filter): string {
  switch (filter) {
    case 'all':
      return 'All'
    case 'completed':
      return 'Trips'
    case 'canceled':
      return 'Canceled'
    default: {
      const unknown: never = filter
      return unknown
    }
  }
}

export default function EarningsActivity() {
  const router = useRouter()
  const { user } = useAuth()
  const { colors, earningsPrivate } = useTheme()
  const [trips, setTrips] = useState<Trip[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const data = await loadEarnings(supabase, user.id)
    setTrips(data.trips || [])
  }, [user])

  useFocusEffect(useCallback(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load activity'))
  }, [refresh]))

  const visible = useMemo(() => trips.filter((trip: Trip) => {
    if (filter === 'all') return true
    return trip.status === filter || (filter === 'canceled' && trip.status === 'cancelled_wait')
  }), [filter, trips])

  const groups = useMemo(() => {
    const map = new Map<string, Trip[]>()
    for (const trip of visible) {
      const key = (trip.completed_at || trip.canceled_at || '').slice(0, 10) || 'Undated'
      const list = map.get(key) || []
      list.push(trip)
      map.set(key, list)
    }
    return [...map.entries()]
  }, [visible])

  return (
    <StackPage title="Earnings activity" onBack={() => router.back()}>
      <View style={styles.filters}>
        {FILTERS.map((item) => {
          const on = item.id === filter
          return (
            <Pressable
              key={item.id}
              onPress={() => setFilter(item.id)}
              style={[styles.chip, { backgroundColor: on ? colors.fill : colors.card }]}
              accessibilityRole="tab"
              accessibilityLabel={`${filterLabel(item.id)} filter`}
              accessibilityState={{ selected: on }}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            >
              <Text style={{ color: on ? colors.onAccent : colors.title, fontWeight: '800' }}>{filterLabel(item.id)}</Text>
            </Pressable>
          )
        })}
        {filter !== 'all' ? (
          <Pressable
            onPress={() => setFilter('all')}
            accessibilityRole="button"
            accessibilityLabel="Clear filter"
            accessibilityHint="Resets filter to show all trips"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={{ color: colors.orange, fontWeight: '800' }}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {!user ? <Primary label="Sign in" onPress={() => router.push('/sign-in')} /> : null}
      {user && groups.length === 0 ? (
        <Card>
          <Text style={{ color: colors.title, fontWeight: '800' }}>No trips in this filter</Text>
          <Text style={{ color: colors.inkSecondary }}>Completed and canceled trips from your driver account show up here.</Text>
        </Card>
      ) : null}
      {groups.map(([day, rows]: [string, Trip[]]) => (
        <View key={day} style={styles.group}>
          <Text style={{ color: colors.inkSecondary, fontWeight: '800' }}>{day}</Text>
          {rows.map((trip: Trip) => {
            const noShow = trip.status === 'cancelled_wait'
            const pay = noShow ? null : carpoolPayFromTrip(trip)
            const boost = noShow ? 0 : readBoostCents(trip)
            const earned = trip.status === 'canceled' ? 0 : tripPayoutCents(trip)
            return (
              <Card key={trip.id}>
                <Pressable
                  onPress={() => router.push({ pathname: '/trip-details', params: { id: trip.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${noShow ? 'No-show fee' : trip.status === 'canceled' ? 'Canceled trip' : 'Completed trip'}, ${trip.pickup_label || 'Pickup'} to ${trip.dropoff_label || 'Drop-off'}, ${trip.status === 'canceled' ? 'No payout' : shownCents(earned, earningsPrivate)}`}
                  accessibilityHint="Opens trip details and breakdown"
                >
                  <Text style={{ color: colors.title, fontWeight: '800' }}>{noShow ? 'No-show fee' : trip.status === 'canceled' ? 'Canceled' : 'Clemson RIDES'}</Text>
                  <Text style={{ color: colors.ink }}>{trip.pickup_label || 'Pickup'}</Text>
                  <Text style={{ color: colors.ink }}>{trip.dropoff_label || 'Drop-off'}</Text>
                  <Text style={{ color: colors.title, fontWeight: '800' }}>
                    {trip.status === 'canceled' ? 'No payout' : shownCents(earned, earningsPrivate)}
                  </Text>
                  {trip.status !== 'canceled' && boost > 0 ? (
                    <Text style={{ color: '#F56600', fontWeight: '800' }}>Boost {formatBoostBadge(boost)}</Text>
                  ) : null}
                  {trip.status !== 'canceled' && pay?.showBonus ? (
                    <Text style={{ color: colors.inkSecondary }}>
                      Base net {shownCents(pay.baseNetCents, earningsPrivate)} · {incentiveLabel(pay.incentiveId)} {shownCents(pay.bonusCents, earningsPrivate)} · total {shownCents(pay.payoutCents, earningsPrivate)}
                    </Text>
                  ) : null}
                </Pressable>
                {trip.status === 'completed' ? (
                  <Pressable
                    onPress={() => router.push({ pathname: '/trip-details', params: { id: trip.id, lost: '1' } })}
                    accessibilityRole="button"
                    accessibilityLabel="Report a lost item"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={{ color: colors.orange, fontWeight: '800' }}>Report a lost item</Text>
                    <Text style={{ color: colors.inkSecondary, fontSize: 13, lineHeight: 18, marginTop: 4 }}>
                      {messagingGuide('driver').reportHint}
                    </Text>
                  </Pressable>
                ) : null}
              </Card>
            )
          })}
        </View>
      ))}
    </StackPage>
  )
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  group: { gap: 8 },
})
