import { StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/Colors';

export default function ScheduleScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Schedule</Text>
      <Text style={styles.body}>
        Placeholder for rider trip calendar and departure windows (GSP / ATL / CLT). Backend hooks
        TBD.
      </Text>
      <View style={styles.box}>
        <Text style={styles.boxLabel}>No trips yet</Text>
        <Text style={styles.boxHint}>Book from Home once booking flow is live.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#fff', gap: 12 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.purple },
  body: { fontSize: 16, lineHeight: 24, color: '#444' },
  box: {
    marginTop: 8,
    padding: 20,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.orange,
    borderStyle: 'dashed',
    alignItems: 'center',
    gap: 6,
  },
  boxLabel: { fontWeight: '700', color: Colors.purple, fontSize: 16 },
  boxHint: { color: '#666', textAlign: 'center' },
});
