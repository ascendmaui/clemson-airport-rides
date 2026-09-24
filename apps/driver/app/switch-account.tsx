import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Text } from 'react-native'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/lib/theme'

export default function SwitchAccountScreen() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { colors } = useTheme()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSignOut() {
    setBusy(true)
    setError(null)
    try {
      await signOut()
      router.replace('/sign-in')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out')
    } finally {
      setBusy(false)
    }
  }

  return (
    <StackPage title="Switch account" onBack={() => router.back()}>
      <Card>
        <Text style={{ color: colors.title, fontWeight: '800', fontSize: 18 }}>One driver on this phone</Text>
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
          {user?.email ? `Signed in as ${user.email}. ` : 'You are signed out. '}
          Sign out to use a different email and password. Multiple accounts are not stored side by side.
        </Text>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {user ? (
          <Primary label={busy ? 'Signing out…' : 'Sign out'} onPress={onSignOut} disabled={busy} />
        ) : (
          <Primary label="Sign in" onPress={() => router.push('/sign-in')} />
        )}
      </Card>
    </StackPage>
  )
}
