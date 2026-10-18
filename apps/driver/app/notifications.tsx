import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BackButton, Card, Primary } from '@/components/chrome'
import { DayHeader, EmptyState, FadeIn } from '@/components/day'
import { useAuth } from '@/lib/auth'
import {
  isRideOfferNotice,
  loadDriverNotifications,
  markAllDriverNotificationsRead,
  markDriverNotificationRead,
  tripIdOf,
  type DriverNotice,
} from '@/lib/driverNotifications'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { ORANGE, PURPLE } from 'rides-native/places.js'

function whenLabel(value: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function NotificationsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors } = useTheme()
  const [rows, setRows] = useState<DriverNotice[]>([])
  const [ready, setReady] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const unread = rows.some((row) => !row.read_at)

  const refresh = useCallback(async () => {
    if (!user || !supabase) {
      setRows([])
      setReady(true)
      return
    }
    try {
      const next = await loadDriverNotifications(supabase, user.id)
      setRows(next)
      setNote(null)
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Notifications are unavailable')
    } finally {
      setReady(true)
    }
  }, [user])

  useFocusEffect(useCallback(() => {
    refresh().catch(() => setReady(true))
  }, [refresh]))

  async function onOpen(row: DriverNotice) {
    if (user && supabase && !row.read_at) {
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, read_at: new Date().toISOString() } : item))
      try {
        await markDriverNotificationRead(supabase, user.id, row.id)
      } catch (err) {
        setNote(err instanceof Error ? err.message : 'Could not mark this notification read')
      }
    }
    const tripId = tripIdOf(row)
    if (isRideOfferNotice(row) && tripId) {
      router.push({ pathname: '/', params: { offer: tripId } })
    }
  }

  async function onMarkAll() {
    if (!user || !supabase) return
    const readAt = new Date().toISOString()
    setRows((current) => current.map((item) => item.read_at ? item : { ...item, read_at: readAt }))
    try {
      await markAllDriverNotificationsRead(supabase, user.id)
      setNote(null)
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not mark notifications read')
      refresh().catch(() => undefined)
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <View style={styles.head}>
        <BackButton onPress={() => router.back()} />
        <DayHeader
          kicker="Clemson Rides"
          title="Notifications"
          trailing={unread ? (
            <Pressable
              onPress={() => { onMarkAll().catch(() => undefined) }}
              accessibilityRole="button"
              accessibilityLabel="Mark all read"
            >
              <Text style={{ color: colors.orange, fontWeight: '800' }}>Mark all read</Text>
            </Pressable>
          ) : null}
        />
      </View>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <FadeIn token={rows.length} style={{ gap: 12 }}>
          {!user ? (
            <EmptyState
              icon="log-in"
              title="Sign in to see notifications"
              body="Ride requests, trip updates, and account alerts are saved on your driver account."
              action={<Primary label="Sign in" onPress={() => router.push('/sign-in')} />}
            />
          ) : null}
          {user && !ready ? (
            <Card>
              <Text style={{ color: colors.title, fontWeight: '800' }}>Checking notifications</Text>
              <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>Looking up messages for this account.</Text>
            </Card>
          ) : null}
          {note ? <Text style={{ color: colors.danger, lineHeight: 20 }}>{note}</Text> : null}
          {user && ready && !note && rows.length === 0 ? (
            <EmptyState
              icon="mail-open"
              title="No notifications yet"
              body="Ride requests, trip updates, and account alerts will show up here."
            />
          ) : null}
          {user && ready && rows.length > 0 ? rows.map((row) => {
            const unreadRow = !row.read_at
            return (
              <Pressable
                key={row.id}
                onPress={() => { onOpen(row).catch(() => undefined) }}
                accessibilityRole="button"
                accessibilityLabel={unreadRow ? `Unread. ${row.title}. ${row.body}` : `${row.title}. ${row.body}`}
              >
                <Card>
                  <View style={styles.rowHead}>
                    {unreadRow ? <View style={[styles.dot, { backgroundColor: ORANGE }]} /> : <View style={[styles.dot, { backgroundColor: PURPLE, opacity: 0.35 }]} />}
                    <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16, flex: 1 }}>{row.title}</Text>
                  </View>
                  {row.body ? <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{row.body}</Text> : null}
                  {row.created_at ? <Text style={{ color: colors.inkSecondary, fontSize: 12 }}>{whenLabel(row.created_at)}</Text> : null}
                </Card>
              </Pressable>
            )
          }) : null}
        </FadeIn>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  head: { paddingHorizontal: 16 },
  list: { padding: 16, paddingBottom: 32 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
})
