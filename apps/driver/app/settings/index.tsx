import { useRouter } from 'expo-router'
import { Text } from 'react-native'
import { FadeIn, type MenuRow, RowGroup, SoftNote } from '@/components/day'
import { SectionLabel, StackPage } from '@/components/shell'
import { useTheme } from '@/lib/theme'

export default function SettingsScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const account: MenuRow[] = [
    { icon: 'person', title: 'Manage Clemson RIDES account', subtitle: 'Name, email, and sign out', onPress: () => router.push('/account') },
    { icon: 'lock-closed', title: 'Privacy', subtitle: 'Hide earnings on this phone', onPress: () => router.push('/settings/privacy') },
    { icon: 'pencil', title: 'Edit address', subtitle: 'Home address is not saved yet', onPress: () => router.push('/settings/address') },
  ]
  const general: MenuRow[] = [
    { icon: 'accessibility', title: 'Accessibility', subtitle: 'Text size follows the phone', onPress: () => router.push('/settings/accessibility') },
    { icon: 'sunny', title: 'Display', subtitle: 'Auto, light, or dark', onPress: () => router.push('/settings/display') },
    { icon: 'chatbubbles', title: 'Communication', subtitle: 'Trip alerts on this phone', onPress: () => router.push('/settings/communication') },
    { icon: 'navigate', title: 'Navigation', subtitle: 'Apple Maps or Google Maps', onPress: () => router.push('/settings/navigation') },
    { icon: 'volume-high', title: 'Sounds and voice', subtitle: 'Request chime', onPress: () => router.push('/settings/sounds') },
  ]

  return (
    <StackPage title="Settings" onBack={() => router.back()}>
      <FadeIn style={{ gap: 12 }}>
        <SoftNote>These choices stay on this phone. Your driver profile, documents, and payouts stay on your Clemson RIDES account.</SoftNote>
        <SectionLabel>Account</SectionLabel>
        <RowGroup rows={account} />
        <SectionLabel>General</SectionLabel>
        <RowGroup rows={general} />
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
          Auto display follows sunrise and sunset. It does not follow the phone’s system appearance.
        </Text>
      </FadeIn>
    </StackPage>
  )
}
