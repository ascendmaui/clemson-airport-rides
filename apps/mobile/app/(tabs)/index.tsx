import { StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/Colors';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>CLEMSON RIDES</Text>
      </View>
      <Text style={styles.title}>Airport rides, campus-ready</Text>
      <Text style={styles.subtitle}>
        Book trips between Clemson and nearby airports. Driver matching and schedules land here.
      </Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Integrations</Text>
        <Text style={styles.row}>
          Auth: Supabase
        </Text>
        <Text style={styles.row}>
          Supabase:{' '}
          {isSupabaseConfigured() ? 'configured' : 'stub (set EXPO_PUBLIC_SUPABASE_URL / ANON_KEY)'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#fff',
    gap: 16,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.orange,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  badgeText: {
    color: '#fff',
    fontWeight: '800',
    letterSpacing: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.purple,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: '#444',
  },
  card: {
    marginTop: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f7f3fb',
    borderWidth: 1,
    borderColor: '#e2d6f0',
    gap: 8,
  },
  cardTitle: {
    fontWeight: '700',
    color: Colors.purple,
    marginBottom: 4,
  },
  row: {
    fontSize: 14,
    color: '#333',
  },
});
