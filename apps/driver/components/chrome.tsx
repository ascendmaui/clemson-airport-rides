import { GlassButton, GlassCard, GlassSurface, glassTextColor } from 'rides-native/glass'
import { Glyph } from 'rides-native/icons'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native'
import { radius, shadowStyle, type as typeScale, type ElevationLevel } from 'rides-native/shared/theme.js'
import { useTheme } from '@/lib/theme'
import type { Palette } from '@/lib/palette'

export function useLift(level: ElevationLevel = 'rest') {
  const { colors, scheme } = useTheme()
  return useMemo(
    () => shadowStyle(colors.shadow, level, scheme),
    [colors.shadow, level, scheme],
  )
}

export function useCardShadow() {
  return useLift('rest')
}

export function BackButton({ onPress }: { onPress: () => void }) {
  const { scheme } = useTheme()
  const ink = glassTextColor({ app: 'driver', scheme, variant: 'fab' })
  return (
    <GlassButton
      app="driver"
      scheme={scheme}
      variant="fab"
      onPress={onPress}
      accessibilityLabel="Back"
      accessibilityHint="Navigates to previous screen"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      showStreak={false}
      style={styles.back}
    >
      <Glyph name="back" size={20} color={ink} strokeWidth={2.6} accessibilityLabel="Back" />
    </GlassButton>
  )
}

export function Primary({
  label,
  onPress,
  disabled,
  tone = 'orange',
  accessibilityLabel,
  accessibilityRole = 'button',
  icon,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  icon?: string
  tone?: 'orange' | 'purple' | 'ghost'
  accessibilityLabel?: string
  accessibilityRole?: 'button' | 'link'
}) {
  const { scheme } = useTheme()
  const accent = tone === 'orange' ? 'orange' : 'purple'
  const variant = tone === 'ghost' ? 'ghost' : 'primary'
  const color = glassTextColor({ app: 'driver', scheme, variant, accent })
  return (
    <GlassButton
      app="driver"
      scheme={scheme}
      variant={variant}
      accent={accent}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={[styles.primary, { flexDirection: 'row', gap: 8 }]}
    >
      {icon ? <Glyph name={icon} size={20} color={color} /> : null}
      <Text style={[styles.primaryLabel, { color }]}>{label}</Text>
    </GlassButton>
  )
}

export function Tag({ label, tone = 'purple' }: { label: string; tone?: 'purple' | 'orange'; key?: string | number }) {
  const { scheme } = useTheme()
  const accent = tone === 'orange' ? 'orange' : 'purple'
  const color = glassTextColor({ app: 'driver', scheme, variant: 'chip', accent })
  return (
    <GlassSurface app="driver" scheme={scheme} variant="chip" accent={accent} selected={tone === 'orange'} style={styles.tag}>
      <Text style={[styles.tagLabel, { color }]}>{label}</Text>
    </GlassSurface>
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
            borderColor: colors.border,
            minHeight: multiline ? 96 : undefined,
            textAlignVertical: multiline ? 'top' : 'center',
          },
        ]}
      />
    </View>
  )
}

export function Card({
  children,
  style,
  accessibilityRole,
  accessibilityLabel,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  accessibilityRole?: string
  accessibilityLabel?: string
  key?: string | number
}) {
  const { scheme } = useTheme()
  return (
    <GlassCard
      app="driver"
      scheme={scheme}
      accessibilityRole={accessibilityRole as any}
      accessibilityLabel={accessibilityLabel}
      style={[styles.card, style]}
    >
      {children}
    </GlassCard>
  )
}

export function ErrorText({ children }: { children: string }) {
  const { colors } = useTheme()
  return <Text style={[styles.error, { color: colors.danger }]}>{children}</Text>
}

export function screenColors(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    kicker: { color: colors.orange, ...typeScale.kicker },
    title: { ...typeScale.title, color: colors.title },
    copy: { color: colors.inkSecondary, ...typeScale.body },
  }
}

const styles = StyleSheet.create({
  back: {
    width: 40,
    height: 40,
    borderRadius: radius.control,
    padding: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLabel: { fontSize: 18, fontWeight: '700' },
  primary: {
    borderRadius: radius.lg,
    minHeight: 52,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryLabel: {
    fontWeight: typeScale.button.fontWeight,
    fontSize: typeScale.button.fontSize,
    letterSpacing: typeScale.button.letterSpacing,
  },
  tag: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  tagLabel: { fontSize: typeScale.kickerSm.fontSize, fontWeight: '800', letterSpacing: 0.2 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.1 },
  input: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  card: { borderRadius: radius.xl, padding: 16, gap: 10 },
  error: { fontSize: 13, lineHeight: 18 },
})
