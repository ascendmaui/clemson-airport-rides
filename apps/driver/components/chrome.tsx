import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTheme } from '@/lib/theme'
import type { Palette } from '@/lib/palette'

export function useCardShadow() {
  const { colors } = useTheme()
  return useMemo(() => ({
    shadowColor: colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  }), [colors.shadow])
}

export function BackButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme()
  const shadow = useCardShadow()
  return (
    <Pressable
      onPress={onPress}
      style={[styles.back, shadow, { backgroundColor: colors.card }]}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <Text style={[styles.backLabel, { color: colors.title }]}>←</Text>
    </Pressable>
  )
}

export function Primary({
  label,
  onPress,
  disabled,
  tone = 'orange',
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  tone?: 'orange' | 'purple' | 'ghost'
}) {
  const { colors } = useTheme()
  const shadow = useCardShadow()
  const background = tone === 'orange' ? colors.orange : tone === 'purple' ? colors.fill : colors.card
  const color = tone === 'ghost' ? colors.title : colors.onAccent
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[styles.primary, shadow, { backgroundColor: background, opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={[styles.primaryLabel, { color }]}>{label}</Text>
    </Pressable>
  )
}

export function Tag({ label, tone = 'purple' }: { label: string; tone?: 'purple' | 'orange' }) {
  const { colors } = useTheme()
  const on = tone === 'orange'
  return (
    <View style={[styles.tag, { backgroundColor: on ? 'rgba(245,102,0,0.16)' : colors.track }]}>
      <Text style={[styles.tagLabel, { color: on ? colors.orange : colors.title }]}>{label}</Text>
    </View>
  )
}

export function Field({
  label,
  value,
  onChangeText,
  secure,
  keyboard,
  placeholder,
  multiline,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  secure?: boolean
  keyboard?: 'default' | 'phone-pad' | 'number-pad' | 'email-address'
  placeholder?: string
  multiline?: boolean
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.inkSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        keyboardType={keyboard || 'default'}
        placeholder={placeholder}
        placeholderTextColor={colors.inkSecondary}
        autoCapitalize={keyboard && keyboard !== 'default' ? 'none' : 'sentences'}
        autoCorrect={false}
        multiline={multiline}
        style={[
          styles.input,
          {
            backgroundColor: colors.input,
            color: colors.ink,
            minHeight: multiline ? 96 : undefined,
            textAlignVertical: multiline ? 'top' : 'center',
          },
        ]}
      />
    </View>
  )
}

export function Card({ children }: { children: ReactNode }) {
  const { colors } = useTheme()
  const shadow = useCardShadow()
  return <View style={[styles.card, shadow, { backgroundColor: colors.card }]}>{children}</View>
}

export function ErrorText({ children }: { children: string }) {
  const { colors } = useTheme()
  return <Text style={[styles.error, { color: colors.danger }]}>{children}</Text>
}

export function screenColors(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.1, fontSize: 12 },
    title: { fontSize: 28, fontWeight: '800' as const, color: colors.title, letterSpacing: -0.4 },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
  }
}

const styles = StyleSheet.create({
  back: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLabel: { fontSize: 18, fontWeight: '700' },
  primary: { borderRadius: 16, paddingVertical: 16, alignItems: 'center', paddingHorizontal: 16 },
  primaryLabel: { fontWeight: '700', fontSize: 16 },
  tag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  tagLabel: { fontSize: 11, fontWeight: '800' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '700' },
  input: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  card: { borderRadius: 22, padding: 16, gap: 10 },
  error: { fontSize: 13, lineHeight: 18 },
})
