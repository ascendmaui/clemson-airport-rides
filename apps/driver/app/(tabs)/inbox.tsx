import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Card, Primary, Tag } from '@/components/chrome'
import { DayHeader, EmptyState, FadeIn, SoftNote } from '@/components/day'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { authedJson } from 'rides-native/apiClient'

type Notice = {
  id: string
  title: string
  body: string
}

const NOTICES: Notice[] = [
  {
    id: 'planner',
    title: 'Campus planner',
    body: 'A planner for offline hours and stadium zones is not in this build yet. Use Discover for typical campus demand.',
  },
  {
    id: 'documents',
    title: 'Keep documents current',
    body: 'License, insurance, and registration still upload from the driver application. An admin reviews them on the web queue.',
  },
  {
    id: 'gameday',
    title: 'Game day staging',
    body: 'When a game day is active, the home map shows the pickup zone and the rider fare multiplier.',
  },
  {
    id: 'split',
    title: 'Your fare split',
    body: 'Open Earnings for the 80% you keep and the 20% Clemson RIDES platform fee on completed trips.',
  },
]

type Ticket = { id?: string; subject?: string; status?: string; created_at?: string }
type InboxTab = 'notifications' | 'support'

function ticketStatus(status: string | undefined): string {
  const value = (status || 'open').replace(/_/g, ' ')
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export default function InboxScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors } = useTheme()
  const [tab, setTab] = useState<InboxTab>('notifications')
  const [hidden, setHidden] = useState<string[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [supportNote, setSupportNote] = useState<string | null>(null)
  const [supportReady, setSupportReady] = useState(false)
  const notices = NOTICES.filter((notice) => !hidden.includes(notice.id))

  const refresh = useCallback(async () => {
    if (!user || !supabase) {
      setSupportReady(true)
      return
    }
    try {
      const data = await authedJson(supabase, '/api/support-ticket')
      const rows = Array.isArray(data.tickets) ? data.tickets as Ticket[] : []
      setTickets(rows)
      setSupportNote(null)
    } catch (err) {
      setSupportNote(err instanceof Error ? err.message : 'Support tickets are unavailable')
    } finally {
      setSupportReady(true)
    }
  }, [user])

  useFocusEffect(useCallback(() => {
    refresh().catch(() => setSupportReady(true))
  }, [refresh]))

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <View style={styles.head}>
        <DayHeader
          kicker="CLEMSON RIDES"
          title="Inbox"
          trailing={tab === 'notifications' && notices.length > 0 ? (
            <Pressable
              onPress={() => setHidden(NOTICES.map((notice) => notice.id))}
              accessibilityRole="button"
              accessibilityLabel="Clear sample notices"
            >
              <Text style={{ color: colors.orange, fontWeight: '800' }}>Clear</Text>
            </Pressable>
          ) : null}
        />
      </View>
      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        <InboxTabButton
          label={notices.length ? `Notifications ${notices.length}` : 'Notifications'}
          active={tab === 'notifications'}
          onPress={() => setTab('notifications')}
        />
        <InboxTabButton
          label="Support"
          active={tab === 'support'}
          onPress={() => setTab('support')}
        />
      </View>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <FadeIn token={tab} style={{ gap: 12 }}>
          {tab === 'notifications' ? (
            <>
              <SoftNote>
                These sample notices stay on this phone until a driver inbox is connected. They are not live account messages.
              </SoftNote>
              {notices.length === 0 ? (
                <EmptyState
                  icon="mail-open"
                  title="You're caught up"
                  body="Sample notices are hidden on this phone. Account messages will show here when a driver inbox is connected."
                  action={<Primary label="Show sample notices" onPress={() => setHidden([])} tone="ghost" />}
                />
              ) : notices.map((notice) => (
                <Card key={notice.id}>
                  <Tag label="Sample" tone="orange" />
                  <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16 }}>{notice.title}</Text>
                  <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{notice.body}</Text>
                  <Pressable
                    onPress={() => setHidden((current) => current.includes(notice.id) ? current : [...current, notice.id])}
                    accessibilityRole="button"
                    accessibilityLabel={`Hide ${notice.title}`}
                  >
                    <Text style={{ color: colors.orange, fontWeight: '800' }}>Hide</Text>
                  </Pressable>
                </Card>
              ))}
            </>
          ) : (
            <>
              <SoftNote>
                Tickets filed from Bug Reporter. Email rides@clemson.edu if the ticket service is down.
              </SoftNote>
              {!user ? (
                <EmptyState
                  icon="log-in"
                  title="Sign in to see tickets"
                  body="Bug reports you file from this app are tied to your driver account."
                  action={<Primary label="Sign in" onPress={() => router.push('/sign-in')} />}
                />
              ) : null}
              {user && !supportReady ? (
                <Card>
                  <Text style={{ color: colors.title, fontWeight: '800' }}>Checking tickets</Text>
                  <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>Looking up bug reports on your account.</Text>
                </Card>
              ) : null}
              {supportNote ? <Text style={{ color: colors.danger, lineHeight: 20 }}>{supportNote}</Text> : null}
              {user && supportReady && !supportNote && tickets.length === 0 ? (
                <EmptyState
                  icon="chatbubbles"
                  title="No tickets yet"
                  body="When you file a bug from this app, the subject and status show up here. Nothing is waiting right now."
                  action={<Primary label="File a bug report" onPress={() => router.push('/bug-report')} tone="purple" />}
                />
              ) : null}
              {user && supportReady && tickets.length > 0 ? (
                <>
                  {tickets.map((ticket) => (
                    <Card key={ticket.id || ticket.subject}>
                      <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16 }}>{ticket.subject || 'Ticket'}</Text>
                      <Text style={{ color: colors.inkSecondary }}>
                        {ticketStatus(ticket.status)}{ticket.created_at ? ` · ${ticket.created_at.slice(0, 10)}` : ''}
                      </Text>
                    </Card>
                  ))}
                  <Primary label="File a bug report" onPress={() => router.push('/bug-report')} tone="purple" />
                </>
              ) : null}
            </>
          )}
        </FadeIn>
      </ScrollView>
    </View>
  )
}

function InboxTabButton({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable onPress={onPress} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: active }}>
      <Text style={{ color: active ? colors.orange : colors.inkSecondary, fontWeight: '800' }}>{label}</Text>
      {active ? <View style={[styles.underline, { backgroundColor: colors.orange }]} /> : <View style={styles.underlineSpacer} />}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  head: { paddingHorizontal: 16 },
  tabs: { flexDirection: 'row', marginTop: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', paddingBottom: 10, gap: 8 },
  underline: { height: 3, width: '70%', borderRadius: 999 },
  underlineSpacer: { height: 3, width: '70%' },
  list: { padding: 16, paddingBottom: 32 },
})
