import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'

export const cardShadow = {
  shadowColor: '#1A1033',
  shadowOpacity: 0.12,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 10 },
  elevation: 8,
} as const

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.back} accessibilityRole="button">
      <Text style={styles.backLabel}>←</Text>
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
  const background = tone === 'orange' ? ORANGE : tone === 'purple' ? PURPLE : '#fff'
  const color = tone === 'ghost' ? PURPLE : '#fff'
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[styles.primary, { backgroundColor: background, opacity: disabled ? 0.5 : 1 }, cardShadow]}
    >
      <Text style={[styles.primaryLabel, { color }]}>{label}</Text>
    </Pressable>
  )
}

export function Tag({ label, tone = 'purple' }: { label: string; tone?: 'purple' | 'orange' }) {
  const on = tone === 'orange'
  return (
    <View style={[styles.tag, on ? styles.tagOrange : styles.tagPurple]}>
      <Text style={[styles.tagLabel, on ? styles.tagLabelOrange : styles.tagLabelPurple]}>{label}</Text>
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
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  secure?: boolean
  keyboard?: 'default' | 'phone-pad' | 'number-pad'
  placeholder?: string
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        keyboardType={keyboard || 'default'}
        placeholder={placeholder}
        placeholderTextColor="#8B939E"
        autoCapitalize={keyboard ? 'none' : 'words'}
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  )
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={[styles.card, cardShadow]}>{children}</View>
}

export function ErrorText({ children }: { children: string }) {
  return <Text style={styles.error}>{children}</Text>
}

const styles = StyleSheet.create({
  back: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    ...cardShadow,
  },
  backLabel: { color: PURPLE, fontSize: 18, fontWeight: '700' },
  primary: { borderRadius: 16, paddingVertical: 16, alignItems: 'center', paddingHorizontal: 16 },
  primaryLabel: { fontWeight: '700', fontSize: 16 },
  tag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  tagPurple: { backgroundColor: 'rgba(82,45,128,0.1)' },
  tagOrange: { backgroundColor: 'rgba(245,102,0,0.14)' },
  tagLabel: { fontSize: 11, fontWeight: '800' },
  tagLabelPurple: { color: PURPLE },
  tagLabelOrange: { color: ORANGE },
  field: { gap: 6 },
  fieldLabel: { color: INK_SECONDARY, fontSize: 13, fontWeight: '700' },
  input: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: INK,
  },
  card: { backgroundColor: '#fff', borderRadius: 22, padding: 16, gap: 10 },
  error: { color: '#B42318', fontSize: 13, lineHeight: 18 },
})
