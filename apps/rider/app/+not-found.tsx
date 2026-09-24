import { Link, Stack } from 'expo-router'
import { Text, View } from 'react-native'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

export default function NotFound() {
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <>
      <Stack.Screen options={{ title: 'Not found', headerShown: true, headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.title }} />
      <View style={styles.screen}>
        <Text style={styles.title}>That screen is not in the rider app.</Text>
        <Link href="/" style={styles.link}>Back to rides</Link>
      </View>
    </>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, padding: 24, backgroundColor: colors.background },
    title: { fontSize: 18, fontWeight: '700' as const, color: colors.title, textAlign: 'center' as const },
    link: { marginTop: 16, color: colors.orange, fontWeight: '700' as const },
  }
}
