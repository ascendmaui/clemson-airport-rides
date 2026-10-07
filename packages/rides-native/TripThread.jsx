import { useCallback, useEffect, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { chatEndedLine, chatOpenLine, messagingGuide } from '../../shared/copy/messaging.js'
import { MessagingInfoButton } from './MessagingInfo.jsx'
import {
  canOpenLostItemReport,
  fetchLostItemReport,
  fetchTripChat,
  listTripMessages,
  lostItemReportState,
  messageLimitForTrip,
  notifyLostItemReport,
  notifyTripMessage,
  openLostItemReport,
  resolveLostItemReport,
  rideChatBanner,
  rideChatMode,
  RIDE_CHAT_QUICK_REPLIES,
  sendTripMessage,
  sendTripQuickReply,
  subscribeLostItemReports,
  subscribeTripMessages,
  tripPartyRole,
  unreadCountForTrip,
} from './tripMessagesClient.js'

const FALLBACK = {
  card: '#FFFFFF',
  orange: '#F56600',
  title: '#522D80',
  ink: '#0B1220',
  inkSecondary: '#5B6472',
  onAccent: '#FFFFFF',
  elevated: '#F4F5F8',
  purple: '#522D80',
  purpleSoft: 'rgba(82,45,128,0.08)',
  link: '#522D80',
  border: 'rgba(82,45,128,0.12)',
  background: '#F4F5F8',
  danger: '#D92D20',
  placeholder: '#8B939E',
}

export function TripThread({
  supabase,
  tripId,
  userId,
  colors,
  promptLostItem = false,
}) {
  const tone = { ...FALLBACK, ...(colors || {}) }
  const [open, setOpen] = useState(Boolean(promptLostItem))
  const [trip, setTrip] = useState(null)
  const [report, setReport] = useState(null)
  const [rows, setRows] = useState([])
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [unread, setUnread] = useState(0)
  const [reporting, setReporting] = useState(Boolean(promptLostItem))

  const refresh = useCallback(async () => {
    if (!supabase || !tripId) return
    const live = await fetchTripChat(supabase, tripId)
    const lost = await fetchLostItemReport(supabase, tripId).catch(() => null)
    setTrip(live)
    setReport(lost)
    const mode = rideChatMode(live, Date.now(), lost)
    if (mode === 'closed') {
      setRows([])
    } else {
      setRows(await listTripMessages(supabase, tripId, messageLimitForTrip(live, Date.now(), lost)))
    }
    if (userId) {
      const count = await unreadCountForTrip(supabase, tripId, userId).catch(() => 0)
      setUnread(count)
    }
  }, [supabase, tripId, userId])

  useEffect(() => {
    if (!supabase || !tripId) return undefined
    let alive = true
    refresh().catch((err) => {
      if (alive) setError(err instanceof Error ? err.message : 'Could not load messages')
    })
    const unsubMessages = subscribeTripMessages(supabase, tripId, () => {
      refresh().catch(() => {})
    })
    const unsubLost = subscribeLostItemReports(supabase, (payload) => {
      const row = payload?.new
      if (!row || row.trip_id === tripId) refresh().catch(() => {})
    })
    const timer = setInterval(() => {
      refresh().catch(() => {})
    }, 8000)
    return () => {
      alive = false
      unsubMessages()
      unsubLost()
      clearInterval(timer)
    }
  }, [refresh, supabase, tripId])

  useEffect(() => {
    if (promptLostItem) {
      setOpen(true)
      setReporting(true)
    }
  }, [promptLostItem])

  const mode = rideChatMode(trip, Date.now(), report)
  const role = tripPartyRole(trip, userId)
  const lost = lostItemReportState(report)
  const canReport = Boolean(role) && canOpenLostItemReport(trip, Date.now(), role) && lost !== 'open'
  if (!tripId || !trip) return null
  if (mode === 'closed' && !canReport) return null
  const banner = mode === 'closed' && canReport
    ? chatEndedLine()
    : (rideChatBanner(mode, report) ?? (mode === 'compose' ? chatOpenLine() : null))
  const guide = messagingGuide(role === 'driver' ? 'driver' : 'rider')
  const title = mode === 'readonly' ? 'Ride messages' : 'Message'

  async function send(body, quick = false) {
    if (!supabase || mode !== 'compose' || busy) return
    setBusy(true)
    setError(null)
    try {
      const row = quick
        ? await sendTripQuickReply(supabase, { tripId, phrase: body })
        : await sendTripMessage(supabase, { tripId, body })
      if (!quick) setDraft('')
      if (row?.id) await notifyTripMessage(supabase, { tripId, messageId: row.id })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send')
    } finally {
      setBusy(false)
    }
  }

  async function reportItem() {
    if (!supabase || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await openLostItemReport(supabase, { tripId, description: note })
      setNote('')
      setReporting(false)
      if (created?.id) await notifyLostItemReport(supabase, { tripId, reportId: created.id })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the lost-item thread')
    } finally {
      setBusy(false)
    }
  }

  async function resolve() {
    if (!supabase || !report?.id || busy) return
    setBusy(true)
    setError(null)
    try {
      await resolveLostItemReport(supabase, report.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve this thread')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ backgroundColor: tone.card, borderRadius: 20, padding: 16, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? 'Hide ride messages' : title}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          style={{ flex: 1 }}
        >
          <Text style={{ color: tone.orange, fontWeight: '800', letterSpacing: 1.1, fontSize: 11 }}>RIDE CHAT</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: tone.title, fontSize: 18, fontWeight: '800' }}>{title}</Text>
            {unread > 0 ? (
              <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: tone.orange, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
                <Text style={{ color: tone.onAccent, fontSize: 12, fontWeight: '800' }}>{unread > 9 ? '9+' : String(unread)}</Text>
              </View>
            ) : null}
          </View>
          <Text style={{ color: tone.inkSecondary, fontSize: 13, lineHeight: 18 }}>
            {open ? 'Hide messages' : 'Tap to open messages'}
          </Text>
        </Pressable>
        <MessagingInfoButton role={role === 'driver' ? 'driver' : 'rider'} colors={tone} />
      </View>
      {open ? (
        <View style={{ gap: 8 }}>
          {banner ? <Text style={{ color: tone.inkSecondary, fontSize: 13, lineHeight: 18 }}>{banner}</Text> : null}
          {rows.length === 0 ? <Text style={{ color: tone.inkSecondary, fontSize: 13 }}>No messages yet.</Text> : null}
          {rows.map((row) => {
            const mine = row.sender_id === userId
            return (
              <View
                key={row.id}
                style={{
                  alignSelf: mine ? 'flex-end' : 'flex-start',
                  backgroundColor: mine ? tone.orange : tone.elevated,
                  borderRadius: 16,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  maxWidth: '84%',
                }}
              >
                <Text style={{ color: mine ? tone.onAccent : tone.ink, fontSize: 15, lineHeight: 20 }}>{row.body}</Text>
              </View>
            )
          })}
          {lost === 'open' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mark lost item resolved"
              onPress={() => { void resolve() }}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={{ color: tone.link, fontWeight: '800' }}>Mark resolved</Text>
            </Pressable>
          ) : null}
          {canReport ? (
            <View style={{ gap: 8 }}>
              {reporting ? (
                <>
                  <Text style={{ color: tone.inkSecondary, fontSize: 13, lineHeight: 18 }}>{guide.reportHint}</Text>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder="Short note, like black backpack"
                    placeholderTextColor={tone.placeholder}
                    maxLength={80}
                    style={{
                      borderWidth: 1,
                      borderColor: tone.border,
                      borderRadius: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      color: tone.ink,
                      backgroundColor: tone.background,
                    }}
                    accessibilityLabel="Lost item description"
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={role === 'driver' ? 'Report a lost item' : 'I lost an item'}
                    onPress={() => { void reportItem() }}
                    style={{ backgroundColor: tone.orange, borderRadius: 14, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ color: tone.onAccent, fontWeight: '800' }}>
                      {busy ? 'Sending…' : (role === 'driver' ? 'Report a lost item' : 'I lost an item')}
                    </Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={role === 'driver' ? 'Report a lost item' : 'I lost an item'}
                  onPress={() => setReporting(true)}
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <Text style={{ color: tone.orange, fontWeight: '800' }}>
                    {role === 'driver' ? 'Report a lost item' : 'I lost an item'}
                  </Text>
                </Pressable>
                <Text style={{ color: tone.inkSecondary, fontSize: 13, lineHeight: 18 }}>{guide.reportHint}</Text>
              )}
            </View>
          ) : null}
          {mode === 'compose' ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {RIDE_CHAT_QUICK_REPLIES.map((phrase) => (
                  <Pressable
                    key={phrase}
                    accessibilityRole="button"
                    accessibilityLabel={phrase}
                    onPress={() => { void send(phrase, true) }}
                    style={{ backgroundColor: tone.purpleSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 }}
                  >
                    <Text style={{ color: tone.link, fontSize: 12, fontWeight: '700' }}>{phrase}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Message"
                placeholderTextColor={tone.placeholder}
                editable={!busy}
                maxLength={500}
                accessibilityLabel="Message"
                style={{
                  borderWidth: 1,
                  borderColor: tone.border,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  color: tone.ink,
                  backgroundColor: tone.background,
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityState={{ disabled: busy || !draft.trim() }}
                disabled={busy || !draft.trim()}
                onPress={() => { void send(draft) }}
                style={{ alignSelf: 'flex-start', backgroundColor: tone.orange, borderRadius: 14, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center', opacity: busy || !draft.trim() ? 0.5 : 1 }}
              >
                <Text style={{ color: tone.onAccent, fontWeight: '800' }}>{busy ? 'Sending…' : 'Send'}</Text>
              </Pressable>
            </>
          ) : null}
          {error ? <Text style={{ color: tone.danger, fontSize: 13 }}>{error}</Text> : null}
        </View>
      ) : null}
    </View>
  )
}
