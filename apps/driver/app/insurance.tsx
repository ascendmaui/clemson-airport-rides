import { useRouter } from 'expo-router'
import { Text } from 'react-native'
import { Card, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useTheme } from '@/lib/theme'

export default function InsuranceScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  return (
    <StackPage title="Insurance" onBack={() => router.back()}>
      <Card>
        <Text style={{ color: colors.title, fontWeight: '800', fontSize: 18 }}>Trip coverage</Text>
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
          A Clemson RIDES coverage summary is not published in the app yet. This screen is not an insurance policy and does not confirm you are covered.
        </Text>
      </Card>
      <Card>
        <Text style={{ color: colors.title, fontWeight: '800' }}>Your own policy</Text>
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
          Keep a personal auto policy on file. Upload the card from Documents. Offline driving is your own insurance.
        </Text>
      </Card>
      <Card>
        <Text style={{ color: colors.online, fontWeight: '800' }}>Coming soon</Text>
        <Text style={{ color: colors.inkSecondary }}>
          Liability limits, deductibles, and what counts as an active trip will show here after legal copy is ready.
        </Text>
      </Card>
      <Primary label="Upload insurance card" onPress={() => router.push('/onboarding')} tone="purple" />
    </StackPage>
  )
}
