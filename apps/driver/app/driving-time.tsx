import { useRouter } from 'expo-router'
import { Text } from 'react-native'
import { Card } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useTheme } from '@/lib/theme'

export default function DrivingTimeScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  return (
    <StackPage title="Driving time" onBack={() => router.back()}>
      <Card>
        <Text style={{ color: colors.title, fontWeight: '800', fontSize: 18 }}>No limit is enforced</Text>
        <Text style={{ color: colors.ink, lineHeight: 20 }}>
          This build does not track hours online and does not block GO after a set time. Take breaks on your own. A driving-time policy is not connected yet.
        </Text>
      </Card>
    </StackPage>
  )
}
