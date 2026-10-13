import { GlassButton, GlassSurface, glassTextColor } from 'rides-native/glass'
import { Glyph } from 'rides-native/icons'
import { Text, View } from 'react-native'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

export function StackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { colors, scheme } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const ink = glassTextColor({ app: 'rider', scheme, variant: 'header' })
  return (
    <GlassSurface app="rider" scheme={scheme} variant="header" style={styles.header}>
      <GlassButton
        app="rider"
        scheme={scheme}
        variant="fab"
        onPress={onBack}
        accessibilityLabel="Back"
        accessibilityHint="Navigates to previous screen"
        style={styles.back}
      >
        <Glyph name="back" size={20} color={ink} accessibilityLabel="Back" />
      </GlassButton>
      <Text style={[styles.title, { color: ink }]}>{title}</Text>
    </GlassSurface>
  )
}

function makeStyles(colors: Palette) {
  return {
    header: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 8,
      marginHorizontal: 12,
      borderRadius: 22,
    },
    back: {
      width: 40,
      height: 40,
      borderRadius: 20,
      padding: 0,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    title: { fontSize: 22, fontWeight: '800' as const, color: colors.title, letterSpacing: -0.3 },
  }
}
