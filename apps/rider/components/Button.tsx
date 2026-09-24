import { Pressable, StyleSheet, Text, View } from 'react-native'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

type ButtonTone = 'orange' | 'purple' | 'ghost' | 'outline'

function toneStyle(colors: Palette, tone: ButtonTone) {
  switch (tone) {
    case 'orange':
      return { backgroundColor: colors.orange, color: colors.onAccent, borderColor: 'transparent', borderWidth: 0 }
    case 'purple':
      return { backgroundColor: colors.purple, color: colors.onAccent, borderColor: 'transparent', borderWidth: 0 }
    case 'ghost':
      return { backgroundColor: colors.elevated, color: colors.link, borderColor: 'transparent', borderWidth: 0 }
    case 'outline':
      return {
        backgroundColor: colors.purpleSoft,
        color: colors.link,
        borderColor: colors.purple,
        borderWidth: 1.5,
      }
    default: {
      const neverTone: never = tone
      return neverTone
    }
  }
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  tone = 'orange',
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  tone?: ButtonTone
}) {
  const { colors } = useTheme()
  const look = toneStyle(colors, tone)
  const raised = tone === 'orange' || tone === 'purple'
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[
        styles.btn,
        raised ? lift(colors, 'rest') : null,
        {
          backgroundColor: look.backgroundColor,
          borderColor: look.borderColor,
          borderWidth: look.borderWidth,
          opacity: disabled ? 0.55 : 1,
        },
      ]}
    >
      <Text style={[styles.label, { color: look.color }]}>{label}</Text>
    </Pressable>
  )
}

export function Pill({
  label,
  active,
  onPress,
}: {
  label: string
  active?: boolean
  onPress: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable onPress={onPress} style={[styles.pill, active && styles.pillOn]} accessibilityRole="button">
      <Text style={[styles.pillLabel, active && styles.pillLabelOn]}>{label}</Text>
    </Pressable>
  )
}

export function SheetHandle() {
  const styles = useThemedStyles(makeStyles)
  return <View style={styles.handle} />
}

function makeStyles(colors: Palette) {
  return {
    pill: {
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.chip,
    },
    pillOn: { borderColor: colors.orange, backgroundColor: colors.orangeSoft },
    pillLabel: { color: colors.link, fontWeight: '700' as const, fontSize: 12 },
    pillLabelOn: { color: colors.orange },
    handle: {
      alignSelf: 'center' as const,
      width: 42,
      height: 5,
      borderRadius: 999,
      backgroundColor: colors.track,
      marginBottom: 12,
    },
  }
}

const styles = StyleSheet.create({
  btn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center', paddingHorizontal: 16 },
  label: { fontWeight: '700', fontSize: 16 },
})
