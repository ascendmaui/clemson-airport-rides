import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput } from 'react-native'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { authedJson } from 'rides-native/apiClient'

export default function DeleteAccountScreen() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { colors, scheme } = useTheme()
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = confirmText.trim() === 'DELETE'

  async function deleteNow() {
    if (busy || !ready) return
    if (!user || !supabase) {
      router.push('/sign-in')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await authedJson(supabase, '/api/account?action=delete', {
        method: 'POST',
        body: { confirm: 'DELETE' },
      })
      try {
        await signOut()
      } catch {
        // The account is already gone. Leave the signed-in screen either way.
      }
      router.replace('/sign-in')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the account')
    } finally {
      setBusy(false)
    }
  }

  function confirmRequest() {
    if (busy || !ready) return
    Alert.alert(
      'Delete account?',
      'This deletes your Clemson Rides driver account immediately. If you have a trip in progress, deletion waits until that trip ends. You will be signed out.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => void deleteNow() },
      ],
    )
  }

  return (
    <StackPage title="Delete account" onBack={() => router.back()}>
      <Card>
        <Text style={[styles.copy, { color: colors.inkSecondary }]}>
          Deletion is immediate. This removes your driver account and signs you out. A trip in progress must end before the account can be deleted.
        </Text>
        <Text style={[styles.copy, { color: colors.inkSecondary }]}>
          Records needed for completed ride receipts, payouts, and tax reporting are kept in de-identified form where the law requires them.
        </Text>
        <Text style={[styles.copy, { color: colors.inkSecondary }]}>
          Signed in as {user?.email || 'this account'}. Type DELETE to confirm.
        </Text>
        {user ? (
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
            placeholder="DELETE"
            placeholderTextColor={colors.inkSecondary}
            accessibilityLabel="Type DELETE to confirm account deletion"
            style={[styles.input, { backgroundColor: colors.input, color: colors.ink, borderColor: colors.border }]}
          />
        ) : null}
      </Card>
      {user ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete account"
          accessibilityState={{ disabled: busy || !ready }}
          disabled={busy || !ready}
          onPress={confirmRequest}
          style={[styles.deleteButton, { backgroundColor: colors.danger, opacity: busy || !ready ? 0.55 : 1 }]}
        >
          <Text style={[styles.deleteLabel, { color: scheme === 'dark' ? colors.card : colors.onAccent }]}>{busy ? 'Deleting…' : 'Delete account'}</Text>
        </Pressable>
      ) : <Primary label="Sign in to delete your account" onPress={() => router.push('/sign-in')} />}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </StackPage>
  )
}

const styles = StyleSheet.create({
  copy: { fontSize: 15, lineHeight: 22 },
  input: { borderWidth: 1, borderRadius: 16, minHeight: 48, paddingHorizontal: 14, fontSize: 16, marginTop: 8 },
  deleteButton: { borderRadius: 16, minHeight: 48, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  deleteLabel: { fontSize: 16, fontWeight: '700' },
})
