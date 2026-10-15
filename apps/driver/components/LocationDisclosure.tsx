import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Glyph } from 'rides-native/icons'
import { radius, type as typeScale } from 'rides-native/shared/theme.js'
import { useTheme } from '@/lib/theme'
import { BACKGROUND_LOCATION_DISCLOSURE as COPY } from '@/lib/locationDisclosure'

/** Full-screen disclosure shown before the OS background-location prompt. */
export function LocationDisclosure({ visible, onAccept, onDecline }: { visible: boolean; onAccept: () => void; onDecline: () => void }) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onDecline}>
      <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16, paddingHorizontal: 24 }}>
        <ScrollView contentContainerStyle={{ gap: 16 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.orangeSoft }}>
            <Glyph name="locate" size={28} color={colors.orange} />
          </View>
          <Text accessibilityRole="header" style={[typeScale.headline, { color: colors.title }]}>{COPY.title}</Text>
          <Text style={{ color: colors.ink, fontSize: 16, lineHeight: 23 }}>{COPY.body}</Text>
          {COPY.points.map((point) => (
            <View key={point} style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 8, backgroundColor: colors.orange }} />
              <Text style={{ flex: 1, color: colors.inkSecondary, fontSize: 15, lineHeight: 21 }}>{point}</Text>
            </View>
          ))}
          <Text style={{ color: colors.inkSecondary, fontSize: 14, lineHeight: 20 }}>{COPY.next}</Text>
        </ScrollView>
        <View style={{ gap: 10, paddingTop: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={COPY.accept}
            accessibilityHint="Opens the system location permission prompt"
            onPress={onAccept}
            style={({ pressed }) => ({ minHeight: 52, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.purple, opacity: pressed ? 0.85 : 1 })}
          >
            <Text style={[typeScale.button, { color: colors.onAccent }]}>{COPY.accept}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={COPY.decline}
            accessibilityHint="Keeps background location off for this trip"
            onPress={onDecline}
            style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={[typeScale.button, { color: colors.link }]}>{COPY.decline}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}
