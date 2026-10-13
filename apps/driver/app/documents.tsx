import { useRouter } from 'expo-router'
import { Text } from 'react-native'
import { type as typeScale } from 'rides-native/shared/theme.js'
import { Card, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useTheme } from '@/lib/theme'
import { REQUIRED_DOCUMENTS } from 'rides-native/driverOnboardingClient'

function docKicker(stepId: string) {
  switch (stepId) {
    case 'car':
      return 'VEHICLE CHECK'
    case 'license':
      return 'LICENSE'
    case 'insurance':
      return 'INSURANCE'
    case 'registration':
      return 'REGISTRATION'
    default:
      return 'DOCUMENT'
  }
}

export default function DocumentsScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  return (
    <StackPage title="Documents" onBack={() => router.back()}>
      <Text style={{ color: colors.inkSecondary, ...typeScale.body }}>
        Uploads still go through the driver application. An admin reviews them on the web queue. Photo review is not in this app.
      </Text>
      {REQUIRED_DOCUMENTS.map((doc) => (
        <Card key={doc.id}>
          <Text style={{ color: colors.orange, ...typeScale.kickerSm }}>{docKicker(doc.stepId)}</Text>
          <Text style={{ color: colors.title, ...typeScale.cardTitle }}>{doc.label}</Text>
          <Text style={{ color: colors.inkSecondary, ...typeScale.body }}>{doc.hint}</Text>
        </Card>
      ))}
      <Primary label="Open application" onPress={() => router.push('/onboarding')} />
    </StackPage>
  )
}
