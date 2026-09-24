import { useRouter } from 'expo-router'
import { ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AssistChat } from '@/components/AssistChat'
import { RequireAuth } from '@/components/RequireAuth'
import { StackHeader } from '@/components/StackHeader'
import { apiUrl } from '@/lib/apiAuth'
import type { Palette } from '@/lib/palette'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { HELP_CHIPS } from 'rides-native/agentChips.js'

function HelpScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StackHeader title="Help" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.copy}>How Clemson RIDES works. This chat does not file tickets.</Text>
        <AssistChat
          endpoint={apiUrl('/api/admin-drivers?action=help-chat')}
          welcome="Rider Help walks you through booking, Schedule, friends, student discount, and billing. I do not file tickets. For a bad charge or a bug, open Support."
          chips={HELP_CHIPS.rider}
          placeholder="Ask how to book, split a fare, or add a card"
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

export default function HelpRoute() {
  return (
    <RequireAuth>
      <HelpScreen />
    </RequireAuth>
  )
}
