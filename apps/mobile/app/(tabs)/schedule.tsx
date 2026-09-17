import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/Colors';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

/** Rider schedule is browsable; pay/book requires Supabase session (soft prompt). */
export default function ScheduleScreen() {
  async function onBookDeposit() {
    if (!isSupabaseConfigured() || !supabase) {
      Alert.alert('Sign in to book your ride', 'Configure Supabase Auth, then sign in to pay the 25% deposit.');
      return;
    }
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      Alert.alert('Sign in to book your ride', 'Browse freely — sign in only to request or pay your deposit.');
      return;
    }
    Alert.alert('Checkout', 'Stripe deposit flow wires through web /api for now.');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Schedule</Text>
      <Text style={styles.body}>
        Guest-browsable trip windows (GSP / CLT). Auth is required only when you book or pay the 25% deposit.
      </Text>
      <View style={styles.box}>
        <Text style={styles.boxLabel}>Flat airport rates</Text>
        <Text style={styles.boxHint}>GSP $75 · CLT $175 · deposit at checkout</Text>
        <Pressable style={styles.cta} onPress={onBookDeposit}>
          <Text style={styles.ctaText}>Pay deposit</Text>
        </Pressable>
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
    gap: 8,
  },
  boxLabel: { fontWeight: '700', color: Colors.purple, fontSize: 16 },
  boxHint: { color: '#666', textAlign: 'center' },
  cta: {
    marginTop: 8,
    backgroundColor: Colors.orange,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
  },
  ctaText: { color: '#fff', fontWeight: '700' },
});
