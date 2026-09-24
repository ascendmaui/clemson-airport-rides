import { useRouter } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ListRow, SectionLabel } from '@/components/shell'
import { useTheme } from '@/lib/theme'

export default function SettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={[styles.back, { color: colors.orange }]} onPress={() => router.back()}>← Settings</Text>
        <SectionLabel>Account</SectionLabel>
        <ListRow icon="person" title="Manage Clemson RIDES account" onPress={() => router.push('/account')} />
        <ListRow icon="lock-closed" title="Privacy" onPress={() => router.push('/settings/privacy')} />
        <ListRow icon="pencil" title="Edit address" onPress={() => router.push('/settings/address')} />
        <SectionLabel>General</SectionLabel>
        <ListRow icon="accessibility" title="Accessibility" onPress={() => router.push('/settings/accessibility')} />
        <ListRow icon="sunny" title="Display" subtitle="Auto, light, or dark" onPress={() => router.push('/settings/display')} />
        <ListRow icon="chatbubbles" title="Communication" onPress={() => router.push('/settings/communication')} />
        <ListRow icon="navigate" title="Navigation" onPress={() => router.push('/settings/navigation')} />
        <ListRow icon="volume-high" title="Sounds and voice" onPress={() => router.push('/settings/sounds')} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  back: { fontWeight: '800', fontSize: 16, marginBottom: 8 },
})
