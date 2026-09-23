import { Link, Stack } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { PURPLE } from 'rides-native/places.js'

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found', headerShown: true }} />
      <View style={styles.screen}>
        <Text style={styles.title}>That screen is not in the rider app.</Text>
        <Link href="/" style={styles.link}>Back to rides</Link>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 18, fontWeight: '700', color: PURPLE, textAlign: 'center' },
  link: { marginTop: 16, color: '#F56600', fontWeight: '700' },
})
