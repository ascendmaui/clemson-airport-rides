import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { shownCents } from '@/lib/shown'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { loadEarnings } from 'rides-native/driverDesk'
import { carpoolPayFromTrip, tripEarnedCents } from 'rides-native/tripTags'

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
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load activity'))
  }, [refresh]))

  const visible = useMemo(() => trips.filter((trip) => {
    if (filter === 'all') return true
    return trip.status === filter
  }), [filter, trips])

  const groups = useMemo(() => {
    const map = new Map<string, Trip[]>()
    for (const trip of visible) {
      const key = (trip.completed_at || '').slice(0, 10) || 'Undated'
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
            <Pressable key={item.id} onPress={() => setFilter(item.id)} style={[styles.chip, { backgroundColor: on ? colors.fill : colors.card }]}>
              <Text style={{ color: on ? colors.onAccent : colors.title, fontWeight: '800' }}>{filterLabel(item.id)}</Text>
            </Pressable>
          )
        })}
        {filter !== 'all' ? (
          <Pressable onPress={() => setFilter('all')}>
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
      {groups.map(([day, rows]) => (
        <View key={day} style={styles.group}>
          <Text style={{ color: colors.inkSecondary, fontWeight: '800' }}>{day}</Text>
          {rows.map((trip) => {
            const pay = carpoolPayFromTrip(trip)
            return (
              <Pressable key={trip.id} onPress={() => router.push({ pathname: '/trip-details', params: { id: trip.id } })}>
                <Card>
                  <Text style={{ color: colors.title, fontWeight: '800' }}>{trip.status === 'canceled' ? 'Canceled' : 'Clemson RIDES'}</Text>
                  <Text style={{ color: colors.ink }}>{trip.pickup_label || 'Pickup'}</Text>
                  <Text style={{ color: colors.ink }}>{trip.dropoff_label || 'Drop-off'}</Text>
                  <Text style={{ color: colors.title, fontWeight: '800' }}>
                    {trip.status === 'canceled' ? 'No payout' : shownCents(tripEarnedCents(trip), earningsPrivate)}
                  </Text>
                  {trip.status !== 'canceled' && pay?.showBonus ? (
                    <Text style={{ color: colors.inkSecondary }}>
                      Base net {shownCents(pay.baseNetCents, earningsPrivate)} · {pay.incentiveId} {shownCents(pay.bonusCents, earningsPrivate)} · total {shownCents(pay.payoutCents, earningsPrivate)}
                    </Text>
                  ) : null}
                </Card>
              </Pressable>
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
