import { useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { PrimaryButton } from '@/components/Button'
import { authHeaders } from '@/lib/apiAuth'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { postAgent, supportTicketRequest } from 'rides-native/assistClient.js'
import { categoryLabel } from 'rides-native/agentChips.js'

type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string }

type TicketDraft = {
  ready?: boolean
  category?: string
  subject?: string
  body?: string
}

function nextId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function AssistChat({
  endpoint,
  welcome,
  chips,
  placeholder,
  ticketUrl,
}: {
  endpoint: string
  welcome: string
  chips: { label: string; text: string }[]
  placeholder: string
  ticketUrl?: string
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'welcome', role: 'assistant', content: welcome },
  ])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [ticket, setTicket] = useState<TicketDraft | null>(null)
  const [filing, setFiling] = useState(false)

  async function send(text: string) {
    const content = text.trim()
    if (!content || busy) return
    const history = [...messages.filter((message) => message.id !== 'welcome'), { role: 'user' as const, content }]
      .map(({ role, content: value }) => ({ role, content: value }))
    const userId = nextId()
    const pendingId = nextId()
    setMessages((current) => [
      ...current,
      { id: userId, role: 'user', content },
      { id: pendingId, role: 'assistant', content: 'Looking at your account…' },
    ])
    setDraft('')
    setBusy(true)
    setTicket(null)
    setNotice(null)
    try {
      const headers = await authHeaders()
      const result = await postAgent({
        url: endpoint,
        headers,
        body: { messages: history, roleVariant: 'rider' },
      })
      setMessages((current) => current.map((message) => (
        message.id === pendingId ? { ...message, content: result.reply || 'No reply.' } : message
      )))
      setNotice(result.notice || result.contextSummary || null)
      setTicket(result.ticketDraft?.ready ? result.ticketDraft : null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Help could not answer'
      setMessages((current) => current.map((item) => (
        item.id === pendingId ? { ...item, content: message } : item
      )))
    } finally {
      setBusy(false)
    }
  }

  async function fileTicket() {
    if (!ticketUrl || !ticket?.ready || filing) return
    setFiling(true)
    try {
      const headers = await authHeaders()
      const data = await supportTicketRequest({
        url: ticketUrl,
        headers,
        method: 'POST',
        body: {
          confirmed: true,
          category: ticket.category,
          subject: ticket.subject,
          body: ticket.body,
          roleVariant: 'rider',
        },
      })
      const id = data.ticket?.id
      setTicket(null)
      setMessages((current) => [...current, {
        id: nextId(),
        role: 'assistant',
        content: id
          ? `Ticket ${id} is open. Email rides@clemson.edu and mention that id if you need a person sooner.`
          : 'The ticket was filed.',
      }])
    } catch (err) {
      setMessages((current) => [...current, {
        id: nextId(),
        role: 'assistant',
        content: err instanceof Error ? err.message : 'Could not file the ticket. Email rides@clemson.edu.',
      }])
    } finally {
      setFiling(false)
    }
  }

  return (
    <View style={styles.wrap}>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {messages.length < 3 ? (
        <View style={styles.chips}>
          {chips.map((chip) => (
            <Pressable
              key={chip.label}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void send(chip.text)}
              style={[styles.chip, lift(colors, 'rest')]}
            >
              <Text style={styles.chipLabel}>{chip.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <ScrollView style={styles.thread} contentContainerStyle={styles.threadBody}>
        {messages.map((message) => (
          <View key={message.id} style={[styles.bubble, message.role === 'user' ? styles.mine : styles.theirs]}>
            <Text style={message.role === 'user' ? styles.mineText : styles.theirsText}>{message.content}</Text>
          </View>
        ))}
      </ScrollView>
      {ticket?.ready && ticketUrl ? (
        <View style={[styles.draftCard, lift(colors, 'rest')]}>
          <Text style={styles.kicker}>{categoryLabel(ticket.category)}</Text>
          <Text style={styles.draftTitle}>{ticket.subject}</Text>
          <Text style={styles.notice}>{ticket.body}</Text>
          <PrimaryButton label={filing ? 'Filing…' : 'File this ticket'} onPress={() => void fileTicket()} disabled={filing} />
        </View>
      ) : null}
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        editable={!busy}
        multiline
      />
      <PrimaryButton label={busy ? 'Sending…' : 'Send'} onPress={() => void send(draft)} disabled={busy || !draft.trim()} />
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    wrap: { gap: 10 },
    notice: { color: colors.inkSecondary, fontSize: 13, lineHeight: 18 },
    chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
    chip: { backgroundColor: colors.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
    chipLabel: { color: colors.link, fontWeight: '700' as const, fontSize: 13 },
    thread: { maxHeight: 360 },
    threadBody: { gap: 8, paddingVertical: 4 },
    bubble: { borderRadius: 16, padding: 12, maxWidth: '100%' as const },
    mine: { backgroundColor: colors.orange, alignSelf: 'flex-end' as const },
    theirs: { backgroundColor: colors.card, alignSelf: 'flex-start' as const },
    mineText: { color: colors.onAccent, fontSize: 15, lineHeight: 20 },
    theirsText: { color: colors.ink, fontSize: 15, lineHeight: 20 },
    draftCard: { backgroundColor: colors.card, borderRadius: 16, padding: 12, gap: 6 },
    kicker: { color: colors.orange, fontWeight: '800' as const, fontSize: 11, letterSpacing: 1 },
    draftTitle: { color: colors.title, fontWeight: '800' as const, fontSize: 16 },
    input: {
      minHeight: 48,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
    },
  }
}
