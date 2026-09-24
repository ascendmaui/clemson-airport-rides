import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { useCallback } from 'react'
import { Card } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { authedJson } from 'rides-native/apiClient'

type Notice = {
  id: string
  title: string
  body: string
  when: string
}

const NOTICES: Notice[] = [
  {
    id: 'planner',
    title: 'Campus planner',
    body: 'A driver planner for offline hours and stadium zones is not in this build yet.',
    when: 'Sample',
  },
  {
    id: 'documents',
    title: 'Keep documents current',
    body: 'License, insurance, and registration still upload from the driver application.',
    when: 'Sample',
  },
  {
    id: 'gameday',
    title: 'Game day staging',
    body: 'When a game day is active, the home map shows the pickup zone and rider fare multiplier.',
    when: 'Sample',
  },
  {
    id: 'split',
    title: 'Your weekly fare split',
    body: 'Open Earnings for the 80% you keep and the 20% Clemson RIDES platform fee.',
    when: 'Sample',
  },
]

type Ticket = { id?: string; subject?: string; status?: string; created_at?: string }

export default function InboxScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors } = useTheme()
  const [tab, setTab] = useState<'notifications' | 'support'>('notifications')
  const [hidden, setHidden] = useState<string[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [supportNote, setSupportNote] = useState<string | null>(null)
  const notices = NOTICES.filter((notice) => !hidden.includes(notice.id))

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    try {
      const data = await authedJson(supabase, '/api/support-ticket')
      const rows = Array.isArray(data.tickets) ? data.tickets as Ticket[] : []
      setTickets(rows)
      setSupportNote(null)
    } catch (err) {
      setSupportNote(err instanceof Error ? err.message : 'Support tickets are unavailable')
    }
  }, [user])

  useFocusEffect(useCallback(() => {
    refresh().catch(() => {})
  }, [refresh]))

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: colors.title }]}>Inbox</Text>
        {tab === 'notifications' ? (
          <Pressable onPress={() => setHidden(NOTICES.map((notice) => notice.id))}>
            <Text style={{ color: colors.orange, fontWeight: '800' }}>Clear samples</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => setTab('notifications')} style={styles.tab}>
          <Text style={{ color: tab === 'notifications' ? colors.title : colors.inkSecondary, fontWeight: '800' }}>
            Notifications {notices.length ? notices.length : ''}
          </Text>
          {tab === 'notifications' ? <View style={[styles.underline, { backgroundColor: colors.orange }]} /> : null}
        </Pressable>
        <Pressable onPress={() => setTab('support')} style={styles.tab}>
          <Text style={{ color: tab === 'support' ? colors.title : colors.inkSecondary, fontWeight: '800' }}>Support</Text>
          {tab === 'support' ? <View style={[styles.underline, { backgroundColor: colors.orange }]} /> : null}
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {tab === 'notifications' ? (
          <>
            <Text style={{ color: colors.inkSecondary }}>
              These notices are stored on this screen until a driver inbox exists. They are not live account messages.
            </Text>
            {notices.map((notice) => (
              <View key={notice.id} style={[styles.row, { borderBottomColor: colors.border }]}>
                <View style={styles.rowBody}>
                  <Text style={{ color: colors.ink, fontWeight: '800' }}>{notice.title}</Text>
                  <Text style={{ color: colors.inkSecondary }}>{notice.body}</Text>
                  <Text style={{ color: colors.inkSecondary, fontSize: 12 }}>{notice.when}</Text>
                </View>
                <View style={[styles.dot, { backgroundColor: colors.orange }]} />
              </View>
            ))}
          </>
        ) : (
          <>
            <Text style={{ color: colors.inkSecondary }}>
              Tickets filed from Bug Reporter. Email rides@clemson.edu if the ticket service is down.
            </Text>
            {supportNote ? <Text style={{ color: colors.danger }}>{supportNote}</Text> : null}
            {tickets.length === 0 ? (
              <Card>
                <Text style={{ color: colors.title, fontWeight: '800' }}>No tickets yet</Text>
              </Card>
            ) : tickets.map((ticket) => (
              <View key={ticket.id || ticket.subject} style={[styles.row, { borderBottomColor: colors.border }]}>
                <View style={styles.rowBody}>
                  <Text style={{ color: colors.ink, fontWeight: '800' }}>{ticket.subject || 'Ticket'}</Text>
                  <Text style={{ color: colors.inkSecondary }}>{ticket.status || 'open'}{ticket.created_at ? ` · ${ticket.created_at.slice(0, 10)}` : ''}</Text>
                </View>
              </View>
            ))}
            <Pressable onPress={() => router.push('/bug-report')}>
              <Text style={{ color: colors.orange, fontWeight: '800' }}>File a bug report</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  head: { paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 32, fontWeight: '800' },
  tabs: { flexDirection: 'row', marginTop: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', paddingBottom: 10, gap: 8 },
  underline: { height: 3, width: '70%', borderRadius: 999 },
  list: { padding: 16, gap: 12, paddingBottom: 32 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowBody: { flex: 1, gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
})
