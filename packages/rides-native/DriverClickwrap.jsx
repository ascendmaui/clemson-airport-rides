import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  DRIVER_CLICKWRAP_SUMMARY,
  agreeButtonDisabled,
  legalDocument,
} from '../../shared/driverClickwrap.js'

const FALLBACK = {
  background: '#F6F3FA',
  title: '#522D80',
  ink: '#241833',
  inkSecondary: '#5C5470',
  orange: '#F56600',
  card: '#FFFFFF',
  border: 'rgba(82,45,128,0.18)',
  link: '#522D80',
}

function paletteOf(colors) {
  return {
    background: colors?.background || FALLBACK.background,
    title: colors?.title || FALLBACK.title,
    ink: colors?.ink || FALLBACK.ink,
    inkSecondary: colors?.inkSecondary || FALLBACK.inkSecondary,
    orange: colors?.orange || FALLBACK.orange,
    card: colors?.card || FALLBACK.card,
    border: colors?.border || FALLBACK.border,
    link: colors?.link || FALLBACK.link,
  }
}

function DocumentReader({ doc, colors, onBack }) {
  const insets = useSafeAreaInsets()
  const palette = paletteOf(colors)
  const document = legalDocument(doc)
  return (
    <View style={{ flex: 1, backgroundColor: palette.background, paddingTop: insets.top + 12 }}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to agreement"
        hitSlop={12}
        style={{ paddingHorizontal: 20, paddingVertical: 8 }}
      >
        <Text style={{ color: palette.link, fontWeight: '700' }}>Back</Text>
      </Pressable>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 10 }}>
        <Text style={{ color: palette.title, fontSize: 24, fontWeight: '800' }}>{document.title}</Text>
        {document.sections.map((section) => (
          <View key={section.heading} style={{ gap: 6, marginTop: 8 }}>
            <Text style={{ color: palette.title, fontSize: 17, fontWeight: '800' }}>{section.heading}</Text>
            {section.paragraphs?.map((paragraph) => (
              <Text key={paragraph.slice(0, 48)} style={{ color: palette.inkSecondary, fontSize: 15, lineHeight: 22 }}>{paragraph}</Text>
            ))}
            {section.bullets?.map((bullet) => (
              <Text key={bullet.slice(0, 48)} style={{ color: palette.inkSecondary, fontSize: 15, lineHeight: 22 }}>{`• ${bullet}`}</Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

export function DriverClickwrap({ onAgree, busy = false, colors, error, onBack }) {
  const insets = useSafeAreaInsets()
  const palette = paletteOf(colors)
  const [checked, setChecked] = useState(false)
  const [doc, setDoc] = useState(null)
  const disabled = agreeButtonDisabled(checked) || busy

  function agree() {
    if (agreeButtonDisabled(checked) || busy) return
    onAgree?.()
  }

  if (doc) {
    return <DocumentReader doc={doc} colors={colors} onBack={() => setDoc(null)} />
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.background, paddingTop: insets.top + 12 }}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={{ paddingHorizontal: 20, paddingVertical: 8 }}
        >
          <Text style={{ color: palette.link, fontWeight: '700' }}>Back</Text>
        </Pressable>
      ) : null}
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32, gap: 14 }}>
        <Text style={{ color: palette.title, fontSize: 28, fontWeight: '800' }}>Driver Agreement</Text>
        <Text style={{ color: palette.inkSecondary, fontSize: 14, lineHeight: 20 }}>{DRIVER_CLICKWRAP_SUMMARY}</Text>
        <Text style={{ color: palette.inkSecondary, fontSize: 13, lineHeight: 18 }}>
          <Text onPress={() => setDoc('driver-agreement')} style={{ color: palette.link, fontWeight: '700' }} accessibilityRole="link">Driver Agreement</Text>
          {' · '}
          <Text onPress={() => setDoc('terms')} style={{ color: palette.link, fontWeight: '700' }} accessibilityRole="link">Terms</Text>
          {' · '}
          <Text onPress={() => setDoc('privacy')} style={{ color: palette.link, fontWeight: '700' }} accessibilityRole="link">Privacy</Text>
        </Text>
        <Pressable
          onPress={() => setChecked((value) => !value)}
          accessibilityRole="checkbox"
          accessibilityLabel="I have read the Driver Agreement, Terms, and Privacy Policy"
          accessibilityState={{ checked }}
          style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}
        >
          <View style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 1.5,
            borderColor: palette.title,
            marginTop: 2,
            backgroundColor: checked ? palette.orange : palette.card,
          }}
          />
          <Text style={{ flex: 1, color: palette.ink, fontSize: 14, lineHeight: 20 }}>
            I have read and agree to the Driver Agreement, Terms of Service, and Privacy Policy.
          </Text>
        </Pressable>
        {error ? <Text style={{ color: '#9B1B1B', fontSize: 13 }}>{error}</Text> : null}
        <Pressable
          onPress={agree}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="I Agree"
          accessibilityState={{ disabled }}
          style={{
            backgroundColor: palette.orange,
            borderRadius: 16,
            paddingVertical: 16,
            alignItems: 'center',
            opacity: disabled ? 0.55 : 1,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{busy ? 'Saving…' : 'I Agree'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}
