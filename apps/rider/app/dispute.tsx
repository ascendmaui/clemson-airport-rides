import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { RequireAuth } from '@/components/RequireAuth'
import { StackHeader } from '@/components/StackHeader'
import { oneParam } from '@/lib/oneParam'
import { supabase } from '@/lib/supabase'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { authedJson } from 'rides-native/apiClient'

type Dispute = { id: string; status: string; created_at: string; ticket_id: string | null }

function DisputeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const params = useLocalSearchParams<{ trip?: string }>()
  const tripId = oneParam(params.trip)
  const [reason, setReason] = useState('')
  const [dispute, setDispute] = useState<Dispute | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tripId) return
    authedJson(supabase, '/api/trip-messages?action=dispute-summary', { method: 'POST', body: { tripId } })
      .then((result: any) => setDispute(result?.dispute || null))
      .catch(() => {})
  }, [tripId])

  async function submit() {
    if (!tripId || busy) return
    setBusy(true)
    setError(null)
    try {
      const result: any = await authedJson(supabase, '/api/trip-messages?action=dispute', { method: 'POST', body: { tripId, reason } })
      setDispute(result?.dispute || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the dispute.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StackHeader title="Dispute fare" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {dispute ? (
          <View style={[styles.card, lift(colors, 'rest')]}>
            <Text style={styles.cardTitle}>Dispute received</Text>
            <Text style={styles.copy}>
              Support has your note and a summary of the trip record (route, timing, chat, and charges). We will reply in Support.
              Opening a dispute does not change the charge by itself.
            </Text>
            <Text style={styles.copy}>Status: {dispute.status === 'resolved' ? 'Resolved' : 'Open'}</Text>
            <PrimaryButton label="Open Support" tone="purple" onPress={() => router.push('/support')} />
          </View>
        ) : (
          <>
            <Text style={styles.copy}>
              Tell us what looks wrong with the fare. Support reviews the trip record, including route, wait time, timestamps, chat, and charges.
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. I was charged more than the quote"
              placeholderTextColor={colors.placeholder}
              style={styles.input}
              multiline
              maxLength={1000}
              accessibilityLabel="What looks wrong with the fare"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton label={busy ? 'Sending…' : 'Send dispute'} onPress={() => void submit()} disabled={busy || reason.trim().length < 8 || !tripId} />
          </>
        )}
      </ScrollView>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 10, paddingBottom: 40 },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    card: { backgroundColor: colors.card, borderRadius: 16, padding: 14, gap: 6 },
    cardTitle: { color: colors.ink, fontWeight: '800' as const, fontSize: 16 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 12,
      minHeight: 96,
      color: colors.ink,
      backgroundColor: colors.card,
      fontSize: 16,
      textAlignVertical: 'top' as const,
    },
    error: { color: colors.danger, fontSize: 13 },
  }
}

export default function DisputeRoute() {
  return (
    <RequireAuth>
      <DisputeScreen />
    </RequireAuth>
  )
}
