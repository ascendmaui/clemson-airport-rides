import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { RequireAuth } from '@/components/RequireAuth'
import { StackHeader } from '@/components/StackHeader'
import { apiUrl, authHeaders } from '@/lib/apiAuth'
import { useAuth } from '@/lib/auth'
import type { Palette } from '@/lib/palette'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { supportTicketRequest } from 'rides-native/assistClient.js'
import { ACCOUNT_DELETION_TICKET } from 'rides-native/accountDeletion.js'

function DeleteAccountScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const styles = useThemedStyles(makeStyles)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function fileRequest() {
    setBusy(true)
    setError(null)
    try {
      const headers = await authHeaders()
      const data = await supportTicketRequest({
        url: apiUrl('/api/admin-drivers?action=ticket'),
        headers,
        method: 'POST',
        body: {
          ...ACCOUNT_DELETION_TICKET,
          body: `${ACCOUNT_DELETION_TICKET.body} Account email: ${user?.email || 'on file'}.`,
        },
      })
      const id = data.ticket?.id
      setNote(id
        ? `Request ${id} is open. The account stays signed in until support processes it. You can sign out from Account.`
        : 'The deletion request was filed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not file the deletion request')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StackHeader title="Delete account" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.copy}>
          Deletion is a support request, the same path named in the privacy policy. Filing this opens a confirmed account ticket. It does not erase the account on this tap.
        </Text>
        <Text style={styles.copy}>Signed in as {user?.email || 'this account'}.</Text>
        {note ? <Text style={styles.note}>{note}</Text> : (
          <PrimaryButton label={busy ? 'Filing…' : 'File deletion request'} onPress={() => void fileRequest()} disabled={busy} tone="purple" />
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton label="Read the privacy policy" tone="ghost" onPress={() => router.push({ pathname: '/legal', params: { doc: 'privacy' } })} />
      </ScrollView>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 12, paddingBottom: 40 },
    copy: { color: colors.inkSecondary, fontSize: 15, lineHeight: 22 },
    note: { color: colors.link, fontWeight: '700' as const, fontSize: 14, lineHeight: 20 },
    error: { color: colors.danger, fontSize: 13 },
  }
}

export default function DeleteAccountRoute() {
  return (
    <RequireAuth>
      <DeleteAccountScreen />
    </RequireAuth>
  )
}
