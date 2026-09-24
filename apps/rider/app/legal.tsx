import { useLocalSearchParams, useRouter } from 'expo-router'
import { ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StackHeader } from '@/components/StackHeader'
import { oneParam } from '@/lib/oneParam'
import type { Palette } from '@/lib/palette'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { LEGAL_UPDATED, PRIVACY_SECTIONS, TERMS_SECTIONS } from 'rides-native/legalCopy.js'

type Section = { heading: string; paragraphs?: string[]; bullets?: string[] }

function LegalScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ doc?: string }>()
  const doc = oneParam(params.doc, 'privacy') === 'terms' ? 'terms' : 'privacy'
  const styles = useThemedStyles(makeStyles)
  const sections: Section[] = doc === 'terms' ? TERMS_SECTIONS : PRIVACY_SECTIONS
  const title = doc === 'terms' ? 'Terms of Service' : 'Privacy Policy'
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StackHeader title={title} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.meta}>Clemson RIDES · Last updated {LEGAL_UPDATED}</Text>
        <Text style={styles.meta}>The same policy as the website.</Text>
        {sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.heading}>{section.heading}</Text>
            {section.paragraphs?.map((paragraph) => (
              <Text key={paragraph.slice(0, 48)} style={styles.copy}>{paragraph}</Text>
            ))}
            {section.bullets?.map((bullet) => (
              <Text key={bullet.slice(0, 48)} style={styles.copy}>• {bullet}</Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, paddingBottom: 48, gap: 8 },
    meta: { color: colors.inkSecondary, fontSize: 13 },
    section: { marginTop: 12, gap: 6 },
    heading: { color: colors.title, fontSize: 17, fontWeight: '800' as const },
    copy: { color: colors.inkSecondary, fontSize: 15, lineHeight: 22 },
  }
}

export default function LegalRoute() {
  return <LegalScreen />
}
