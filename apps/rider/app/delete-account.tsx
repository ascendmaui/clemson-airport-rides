import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { RequireAuth } from '@/components/RequireAuth'
import { StackHeader } from '@/components/StackHeader'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import type { Palette } from '@/lib/palette'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { authedJson } from 'rides-native/apiClient.js'

function DeleteAccountScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, signOut } = useAuth()
  const styles = useThemedStyles(makeStyles)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = confirmText.trim() === 'DELETE'

  async function deleteNow() {
    if (busy || !ready) return
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
      'This deletes your Clemson Rides account immediately. Open rides are canceled and card holds are released. You will be signed out.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => void deleteNow() },
      ],
    )
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StackHeader title="Delete account" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.copy}>
          Deletion is immediate. This removes your Clemson Rides account, signs you out, and returns you to the welcome screen. Completed ride receipts stay in de-identified form where the law requires them.
        </Text>
        <Text style={styles.copy}>Signed in as {user?.email || 'this account'}.</Text>
        <Text style={styles.copy}>Type DELETE to confirm.</Text>
        <TextInput
          value={confirmText}
          onChangeText={setConfirmText}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="DELETE"
          placeholderTextColor={styles.placeholder.color}
          style={styles.input}
          accessibilityLabel="Type DELETE to confirm account deletion"
          editable={!busy}
        />
        <PrimaryButton
          label={busy ? 'Deleting…' : 'Delete account'}
          onPress={confirmRequest}
          disabled={busy || !ready}
          tone="purple"
        />
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
    input: {
      backgroundColor: colors.input,
      color: colors.ink,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 16,
      minHeight: 48,
      paddingHorizontal: 14,
      fontSize: 16,
    },
    placeholder: { color: colors.placeholder },
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
