import { Text, View } from 'react-native'
import { GlassButton, GlassSurface, glassTextColor } from 'rides-native/glass'
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
  const { scheme } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const color = glassTextColor({ app: 'rider', scheme, variant: 'chip' })
  const body = <Text style={[styles.pillLabel, { color }, active && styles.pillLabelOn]}>{label}</Text>
  if (!onPress) {
    return (
      <GlassSurface app="rider" scheme={scheme} variant="chip" selected={Boolean(active)} style={styles.pill}>
        {body}
      </GlassSurface>
    )
  }
  return (
    <GlassButton
      onPress={onPress}
      app="rider"
      scheme={scheme}
      variant="chip"
      selected={Boolean(active)}
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(active) }}
      hitSlop={8}
    >
      {body}
    </GlassButton>
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
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    pillLabel: { color: colors.link, fontWeight: '700' as const, fontSize: typeScale.meta.fontSize, letterSpacing: typeScale.meta.letterSpacing },
    pillLabelOn: { fontWeight: '800' as const },
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
