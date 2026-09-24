import { Pressable, Text, View } from 'react-native'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

export function StackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={[styles.back, lift(colors, 'rest')]} accessibilityRole="button">
        <Text style={styles.backLabel}>←</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
    back: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: colors.card,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    backLabel: { fontSize: 18, color: colors.title, fontWeight: '700' as const },
    title: { fontSize: 22, fontWeight: '800' as const, color: colors.title, letterSpacing: -0.3 },
  }
}
