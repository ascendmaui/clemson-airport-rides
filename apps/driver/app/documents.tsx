import { useRouter } from 'expo-router'
import { Text } from 'react-native'
import { Card, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useTheme } from '@/lib/theme'
import { REQUIRED_DOCUMENTS } from 'rides-native/driverOnboardingClient'

export default function DocumentsScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  return (
    <StackPage title="Documents" onBack={() => router.back()}>
      <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
        Uploads still go through the driver application. An admin reviews them on the web queue. Photo review is not in this app.
      </Text>
      {REQUIRED_DOCUMENTS.map((doc) => (
        <Card key={doc.id}>
          <Text style={{ color: colors.title, fontWeight: '800' }}>{doc.label}</Text>
          <Text style={{ color: colors.inkSecondary }}>{doc.hint}</Text>
        </Card>
      ))}
      <Primary label="Open application" onPress={() => router.push('/onboarding')} />
    </StackPage>
  )
}
