import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text } from 'react-native'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { buildAccountDeletionTicket } from 'rides-native/accountDeletion.js'
import { authedJson } from 'rides-native/apiClient'

export default function DeleteAccountScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const { colors, scheme } = useTheme()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function fileRequest() {
    if (busy || note) return
    if (!user || !supabase) {
      router.push('/sign-in')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await authedJson(supabase, '/api/support-ticket', {
        method: 'POST',
        body: buildAccountDeletionTicket({ email: user.email, roleVariant: 'driver' }),
      })
      const ticket = result.ticket as { id?: string } | undefined
      setNote(ticket?.id
        ? `Request ${ticket.id} is open. Your account stays signed in until support processes it. You can sign out from Account.`
        : 'Your deletion request was filed. Your account stays signed in until support processes it.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not file the deletion request')
    } finally {
      setBusy(false)
    }
  }

  function confirmRequest() {
    if (busy || note) return
    Alert.alert(
      'Request account deletion?',
      'This files a confirmed support request to delete your account and trip history. It does not erase the account immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'File deletion request', style: 'destructive', onPress: () => void fileRequest() },
      ],
    )
  }

  return (
    <StackPage title="Delete account" onBack={() => router.back()}>
      <Card>
        <Text style={[styles.copy, { color: colors.inkSecondary }]}>
          Filing this request asks support to delete your driver account and the trip history tied to it. Your account stays active until support processes the request.
        </Text>
        <Text style={[styles.copy, { color: colors.inkSecondary }]}>
          Records needed for pending payouts and tax reporting are kept where required by law. Account and trip records may also be retained for a reasonable period afterward for accounting, disputes, and safety, as the privacy policy describes.
        </Text>
        <Text style={[styles.copy, { color: colors.inkSecondary }]}>
          Signed in as {user?.email || 'this account'}.
        </Text>
      </Card>
      {note ? <Text accessibilityRole="alert" style={[styles.note, { color: colors.link }]}>{note}</Text> : (
        user ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="File deletion request"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={confirmRequest}
            style={[styles.deleteButton, { backgroundColor: colors.danger, opacity: busy ? 0.55 : 1 }]}
          >
            <Text style={[styles.deleteLabel, { color: scheme === 'dark' ? '#16121F' : '#FFFFFF' }]}>{busy ? 'Filing…' : 'File deletion request'}</Text>
          </Pressable>
        ) : <Primary label="Sign in to request deletion" onPress={() => router.push('/sign-in')} />
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </StackPage>
  )
}

const styles = StyleSheet.create({
  copy: { fontSize: 15, lineHeight: 22 },
  note: { fontSize: 14, lineHeight: 21, fontWeight: '700' },
  deleteButton: { borderRadius: 16, minHeight: 48, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  deleteLabel: { fontSize: 16, fontWeight: '700' },
})
