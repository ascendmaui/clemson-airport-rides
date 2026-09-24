import { Link, Stack } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@/lib/theme'

export default function NotFound() {
  const { colors } = useTheme()
  return (
    <>
      <Stack.Screen options={{ title: 'Not found', headerShown: true }} />
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.title }]}>That screen is not in the driver app.</Text>
        <Link href="/" style={[styles.link, { color: colors.orange }]}>Back to driving</Link>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  link: { marginTop: 16, fontWeight: '700' },
})
