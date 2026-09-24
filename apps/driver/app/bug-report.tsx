import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, ErrorText, Field, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { authedJson } from 'rides-native/apiClient'

const CATEGORIES = ['bug', 'billing', 'ride_dispute', 'account', 'safety', 'other'] as const
type Category = (typeof CATEGORIES)[number]

function categoryLabel(category: Category): string {
  switch (category) {
    case 'bug':
      return 'Bug'
    case 'billing':
      return 'Payout'
    case 'ride_dispute':
      return 'Ride'
    case 'account':
      return 'Account'
    case 'safety':
      return 'Safety'
    case 'other':
      return 'Other'
    default: {
      const unknown: never = category
      return unknown
    }
  }
}

export default function BugReportScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const { colors, scheme } = useTheme()
  const [category, setCategory] = useState<Category>('bug')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!user || !supabase) {
      router.push('/sign-in')
      return
    }
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const result = await authedJson(supabase, '/api/support-ticket', {
        method: 'POST',
        body: { category, subject, body, confirmed, roleVariant: 'driver' },
      })
      const ticket = result.ticket as { id?: string } | undefined
      setNote(ticket?.id ? `Ticket ${ticket.id} is open.` : 'Ticket filed.')
      setSubject('')
      setBody('')
      setConfirmed(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not file the ticket')
    } finally {
      setBusy(false)
    }
  }

  return (
    <StackPage title="Bug Reporter" onBack={() => router.back()}>
      <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
        This files the existing support ticket. You can also email rides@clemson.edu.
      </Text>
      <View style={styles.chips}>
        {CATEGORIES.map((item) => {
          const on = item === category
          return (
            <Pressable key={item} onPress={() => setCategory(item)} style={[styles.chip, { backgroundColor: on ? colors.fill : colors.card }]}>
              <Text style={{ color: on ? colors.onAccent : colors.title, fontWeight: '800' }}>{categoryLabel(item)}</Text>
            </Pressable>
          )
        })}
      </View>
      <Card>
        <Field label="Subject" value={subject} onChangeText={setSubject} placeholder="What broke" />
        <Field label="What happened" value={body} onChangeText={setBody} placeholder="Steps and what you expected" multiline />
        <Pressable onPress={() => setConfirmed((value) => !value)} style={styles.confirm}>
          <View style={[styles.box, { borderColor: scheme === 'dark' ? colors.ink : colors.purple, backgroundColor: confirmed ? colors.orange : 'transparent' }]} />
          <Text style={{ color: colors.ink, flex: 1 }}>I confirm this ticket should be filed.</Text>
        </Pressable>
        <Primary label={busy ? 'Sending…' : 'File ticket'} onPress={submit} disabled={busy} />
      </Card>
      {note ? <Text style={{ color: colors.title, fontWeight: '700' }}>{note}</Text> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </StackPage>
  )
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  confirm: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5 },
})
