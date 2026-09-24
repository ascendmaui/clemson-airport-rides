import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { Text } from 'react-native'
import { Card } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useTheme } from '@/lib/theme'

export default function AboutScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const version = Constants.expoConfig?.version || '1.1.0'
  return (
    <StackPage title="About" onBack={() => router.back()}>
      <Card>
        <Text style={{ color: colors.title, fontSize: 28, fontWeight: '800' }}>Clemson RIDES</Text>
        <Text style={{ color: colors.inkSecondary }}>Driver {version}</Text>
        <Text style={{ color: colors.ink, lineHeight: 20 }}>
          Campus and airport rides for Clemson. This driver app is a separate install from the rider app.
        </Text>
      </Card>
    </StackPage>
  )
}
