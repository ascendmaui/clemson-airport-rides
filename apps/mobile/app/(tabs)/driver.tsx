import { StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/Colors';

export default function DriverScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Driver</Text>
      <Text style={styles.body}>
        Placeholder for driver onboarding, availability, and trip acceptance. Wire to Supabase roles +
        Supabase tables next.
      </Text>
      <View style={styles.pill}>
        <Text style={styles.pillText}>Coming soon</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#fff', gap: 12 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.purple },
  body: { fontSize: 16, lineHeight: 24, color: '#444' },
  pill: {
    alignSelf: 'flex-start',
    marginTop: 8,
    backgroundColor: Colors.orange,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  pillText: { color: '#fff', fontWeight: '700' },
});
