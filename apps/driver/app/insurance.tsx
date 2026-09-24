import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { Card, Primary, Tag } from '@/components/chrome'
import { FadeIn, SoftNote } from '@/components/day'
import { StackPage } from '@/components/shell'
import { useTheme } from '@/lib/theme'

type IconName = keyof typeof Ionicons.glyphMap

export default function InsuranceScreen() {
  const router = useRouter()
  return (
    <StackPage title="Insurance" onBack={() => router.back()}>
      <FadeIn style={{ gap: 12 }}>
        <SoftNote>
          This screen explains what is on file. It is not an insurance policy and does not confirm you are covered on a trip.
        </SoftNote>
        <InfoBlock
          icon="shield-checkmark"
          tag="Not a policy"
          title="Trip coverage"
          body="A Clemson RIDES coverage summary is not published in the app yet. Nothing here confirms that an active trip is insured."
        />
        <InfoBlock
          icon="document-text"
          tag="Your policy"
          title="Personal auto insurance"
          body="Keep a personal auto policy on the car you drive. Upload the card from your driver application. Time you are offline is on that policy."
        />
        <InfoBlock
          icon="time"
          tag="Later"
          title="Limits and deductibles"
          body="Liability limits, deductibles, and which minutes count as an active trip will show here after legal copy is ready."
        />
        <Primary label="Open your application" onPress={() => router.push('/onboarding')} tone="purple" />
        <Primary label="Document checklist" onPress={() => router.push('/documents')} tone="ghost" />
      </FadeIn>
    </StackPage>
  )
}

function InfoBlock({
  icon,
  tag,
  title,
  body,
}: {
  icon: IconName
  tag: string
  title: string
  body: string
}) {
  const { colors } = useTheme()
  return (
    <Card>
      <View style={styles.row}>
        <View style={[styles.badge, { backgroundColor: colors.track }]}>
          <Ionicons name={icon} size={20} color={colors.purple} />
        </View>
        <View style={styles.copy}>
          <Tag label={tag} tone={tag === 'Your policy' ? 'orange' : 'purple'} />
          <Text style={{ color: colors.title, fontWeight: '800', fontSize: 17 }}>{title}</Text>
          <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{body}</Text>
        </View>
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 6 },
})
