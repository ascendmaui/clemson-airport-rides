import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Text } from 'react-native'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { displayTinLast4, loadOnboarding } from 'rides-native/driverOnboardingClient'

export default function TaxScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const { colors } = useTheme()
  const [last4, setLast4] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const bundle = await loadOnboarding(supabase, user.id)
    const tin = bundle?.tax?.tin_last4
    setLast4(tin ? displayTinLast4(String(tin)) : null)
  }, [user])

  useFocusEffect(useCallback(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load tax info'))
  }, [refresh]))

  return (
    <StackPage title="Tax info" onBack={() => router.back()}>
      <Card>
        <Text style={{ color: colors.title, fontWeight: '800' }}>W-9</Text>
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
          {last4 ? `Last four on file: ${last4}.` : 'No W-9 last four on file yet.'} The full tax id is saved only by the existing tax function. Year-end forms are not generated in the app.
        </Text>
      </Card>
      <Card>
        <Text style={{ color: colors.online, fontWeight: '800' }}>Coming soon</Text>
        <Text style={{ color: colors.inkSecondary }}>A yearly earnings summary for taxes will live here. Use Earnings for the trips already on your account.</Text>
      </Card>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Primary label="Update W-9" onPress={() => router.push('/onboarding')} />
    </StackPage>
  )
}
