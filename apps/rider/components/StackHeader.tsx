import { Pressable, StyleSheet, Text, View } from 'react-native'
import { INK, PURPLE } from 'rides-native/places.js'

export function StackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.back} accessibilityRole="button">
        <Text style={styles.backLabel}>←</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLabel: { fontSize: 18, color: PURPLE, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '800', color: INK, letterSpacing: -0.3 },
})
