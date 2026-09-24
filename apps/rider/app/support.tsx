import { useRouter } from 'expo-router'
import { ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AssistChat } from '@/components/AssistChat'
import { RequireAuth } from '@/components/RequireAuth'
import { StackHeader } from '@/components/StackHeader'
import { apiUrl } from '@/lib/apiAuth'
import type { Palette } from '@/lib/palette'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { SUPPORT_CHIPS } from 'rides-native/agentChips.js'

function SupportScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const styles = useThemedStyles(makeStyles)
  const ticketUrl = apiUrl('/api/admin-drivers?action=ticket')
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StackHeader title="Support" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.copy}>
          Problems only. A ticket is filed after you confirm the draft. How-to questions belong in Help.
        </Text>
        <AssistChat
          endpoint={apiUrl('/api/admin-drivers?action=support-chat')}
          ticketUrl={ticketUrl}
          welcome="Support is for problems: a charge, a ride dispute, a bug, account access, or safety. I will draft a ticket and file it only after you confirm."
          chips={SUPPORT_CHIPS.rider}
          placeholder="Describe a charge, a ride, or a bug"
        />
      </ScrollView>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 12, paddingBottom: 40 },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
  }
}

export default function SupportRoute() {
  return (
    <RequireAuth>
      <SupportScreen />
    </RequireAuth>
  )
}
