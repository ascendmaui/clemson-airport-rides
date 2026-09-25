import { useEffect, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { supabase } from '@/lib/supabase'
import {
  fetchTripChat,
  listTripMessages,
  messageLimitForTrip,
  rideChatBanner,
  rideChatMode,
  RIDE_CHAT_QUICK_REPLIES,
  sendTripMessage,
  sendTripQuickReply,
  subscribeTripMessages,
} from 'rides-native/tripMessagesClient.js'

type Row = { id: string; sender_id: string; body: string; created_at: string }

export function RideMessages({ tripId, userId }: { tripId: string; userId: string | null }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'compose' | 'readonly' | 'closed' | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase || !tripId) return undefined
    let alive = true
    async function load() {
      try {
        const trip = await fetchTripChat(supabase, tripId)
        if (!alive) return
        const nextMode = rideChatMode(trip)
        setMode(nextMode)
        if (nextMode === 'closed') {
          setRows([])
          return
        }
        const messages = await listTripMessages(supabase, tripId, messageLimitForTrip(trip))
        if (alive) setRows(messages)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load messages')
      }
    }
    void load()
    const unsub = subscribeTripMessages(supabase, tripId, () => { void load() })
    const timer = setInterval(() => { void load() }, 8000)
    return () => {
      alive = false
      unsub()
      clearInterval(timer)
    }
  }, [tripId])

  if (!tripId || mode === 'closed' || mode === null) return null
  const banner = rideChatBanner(mode)

  async function send(body: string, quick = false) {
    if (!supabase || mode !== 'compose' || busy) return
    setBusy(true)
    setError(null)
    try {
      if (quick) await sendTripQuickReply(supabase, { tripId, phrase: body })
      else await sendTripMessage(supabase, { tripId, body })
      setDraft('')
      const trip = await fetchTripChat(supabase, tripId)
      setRows(await listTripMessages(supabase, tripId, messageLimitForTrip(trip)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.card, lift(colors, 'rest')]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide ride messages' : 'Message your driver'}
        accessibilityHint={open ? 'Hides the thread' : 'Opens the trip message thread'}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
      >
        <Text style={styles.kicker}>RIDE CHAT</Text>
        <Text style={styles.title}>{mode === 'readonly' ? 'Ride messages' : 'Message'}</Text>
        <Text style={styles.copy}>{open ? 'Hide the thread' : 'Same trip_messages thread as the website.'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.thread}>
          {banner ? <Text style={styles.copy}>{banner}</Text> : null}
          {rows.length === 0 ? <Text style={styles.copy}>No messages yet.</Text> : null}
          {rows.map((row) => (
            <View key={row.id} style={row.sender_id === userId ? styles.mine : styles.theirs}>
              <Text style={row.sender_id === userId ? styles.mineText : styles.theirsText}>{row.body}</Text>
            </View>
          ))}
          {mode === 'compose' ? (
            <>
              <View style={styles.chips}>
                {RIDE_CHAT_QUICK_REPLIES.map((phrase) => (
                  <Pressable
                    key={phrase}
                    accessibilityRole="button"
                    accessibilityLabel={phrase}
                    accessibilityHint="Sends this message"
                    hitSlop={8}
                    onPress={() => void send(phrase, true)}
                    style={styles.chip}
                  >
                    <Text style={styles.chipLabel}>{phrase}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Message your driver"
                placeholderTextColor={colors.placeholder}
                style={styles.input}
                editable={!busy}
                accessibilityLabel="Message your driver"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityState={{ disabled: busy || !draft.trim() }}
                disabled={busy || !draft.trim()}
                hitSlop={16}
                onPress={() => void send(draft)}
                style={styles.send}
              >
                <Text style={styles.sendLabel}>{busy ? 'Sending…' : 'Send'}</Text>
              </Pressable>
            </>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : null}
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    card: { backgroundColor: colors.card, borderRadius: 20, padding: 16, gap: 6 },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.1, fontSize: 11 },
    title: { color: colors.title, fontSize: 18, fontWeight: '800' as const },
    copy: { color: colors.inkSecondary, fontSize: 13, lineHeight: 18 },
    thread: { gap: 8, marginTop: 8 },
    mine: { alignSelf: 'flex-end' as const, backgroundColor: colors.orange, borderRadius: 14, padding: 10 },
    theirs: { alignSelf: 'flex-start' as const, backgroundColor: colors.elevated, borderRadius: 14, padding: 10 },
    mineText: { color: colors.onAccent, fontSize: 14 },
    theirsText: { color: colors.ink, fontSize: 14 },
    chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
    chip: { backgroundColor: colors.purpleSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
    chipLabel: { color: colors.link, fontSize: 12, fontWeight: '700' as const },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.ink,
      backgroundColor: colors.background,
    },
    send: { alignSelf: 'flex-start' as const },
    sendLabel: { color: colors.link, fontWeight: '800' as const },
    error: { color: colors.danger, fontSize: 13 },
  }
}
