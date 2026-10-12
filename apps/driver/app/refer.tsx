import { useRouter } from 'expo-router'
import { Share, Text } from 'react-native'
import { Card, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useTheme } from '@/lib/theme'

export default function ReferScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  return (
    <StackPage title="Refer friends" onBack={() => router.back()}>
      <Card>
        <Text style={{ color: colors.title, fontWeight: '800', fontSize: 18 }}>Invite a driver</Text>
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
          Referral credit is not tracked yet. You can still share a note about Clemson RIDES.
        </Text>
        <Primary
          label="Share"
          onPress={() => {
            Share.share({ message: 'Drive with Clemson RIDES. Campus and airport trips for Clemson students.' }).catch(() => {})
          }}
        />
      </Card>
    </StackPage>
  )
}
