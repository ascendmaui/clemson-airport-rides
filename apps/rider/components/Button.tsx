import { Pressable, View } from 'react-native'
import { DenseText } from '@/components/DenseText'
import { GlassButton } from 'rides-native/glass'
import { type as typeScale } from 'rides-native/shared/theme.js'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

type ButtonTone = 'orange' | 'purple' | 'ghost' | 'outline'

function variantFor(tone: ButtonTone): 'primary' | 'secondary' | 'ghost' {
  switch (tone) {
    case 'orange':
    case 'purple':
      return 'primary'
    case 'ghost':
      return 'ghost'
    case 'outline':
      return 'secondary'
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
  key?: string | number
  label: string
  onPress: () => void
  disabled?: boolean
  tone?: ButtonTone
}) {
  const { scheme } = useTheme()
  return (
    <GlassButton
      label={label}
      onPress={onPress}
      disabled={disabled}
      app="rider"
      scheme={scheme}
      variant={variantFor(tone)}
    />
  )
}

export function Pill({
  label,
  active,
  onPress,
}: {
  key?: string | number
  label: string
  active?: boolean
  onPress?: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  const body = (
    <DenseText style={[styles.pillLabel, active && styles.pillLabelOn]} numberOfLines={1}>
      {label}
    </DenseText>
  )
  if (!onPress) {
    return (
      <View
        style={[styles.pill, active && styles.pillOn]}
        accessibilityRole="text"
        accessibilityLabel={label}
        accessibilityState={{ selected: Boolean(active) }}
      >
        {body}
      </View>
    )
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(active) }}
      hitSlop={8}
      style={[styles.pill, active && styles.pillOn]}
    >
      {body}
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
      alignSelf: 'flex-start' as const,
      flexGrow: 0,
      flexShrink: 0,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: colors.purpleSoft,
      borderWidth: 1,
      borderColor: colors.border,
    },
    pillOn: {
      backgroundColor: colors.orange,
      borderColor: colors.orange,
    },
    pillLabel: { color: colors.link, fontWeight: '700' as const, fontSize: typeScale.meta.fontSize, letterSpacing: typeScale.meta.letterSpacing },
    pillLabelOn: { color: colors.onAccent, fontWeight: '800' as const },
    handle: {
      alignSelf: 'center' as const,
      width: 36,
      height: 4,
      borderRadius: 999,
      backgroundColor: colors.track,
      marginTop: 4,
      marginBottom: 10,
    },
  }
}
