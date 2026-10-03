import type { Href } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

type BackRouter = {
  canGoBack: () => boolean
  back: () => void
  replace: (href: Href) => void
}

export function goTabBack(router: BackRouter, fallback?: Href) {
  if (router.canGoBack()) {
    router.back()
    return
  }
  if (fallback) router.replace(fallback)
}

export function TabBackBar({
  onBack,
  padded = true,
  hint = 'Returns to the previous screen',
}: {
  onBack: () => void
  padded?: boolean
  hint?: string
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={[styles.bar, padded ? styles.padded : null]}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        accessibilityHint={hint}
        hitSlop={8}
        style={[styles.back, lift(colors, 'rest')]}
      >
        <Text style={styles.label}>←</Text>
      </Pressable>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    bar: { paddingBottom: 8, alignItems: 'flex-start' as const },
    padded: { paddingHorizontal: 16 },
    back: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.card,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    label: { fontSize: 18, color: colors.title, fontWeight: '700' as const },
  }
}
