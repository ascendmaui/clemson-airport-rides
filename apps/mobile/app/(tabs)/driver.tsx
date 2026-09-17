import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/Colors';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

/** Driver stays behind auth — guests see a soft sign-in prompt, not the accept UI. */
export default function DriverScreen() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isSupabaseConfigured() || !supabase) {
        if (alive) setAuthed(false);
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (alive) setAuthed(Boolean(data.session));
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (authed === false) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Driver</Text>
        <Text style={styles.body}>Sign in to go online and accept rides. Rider browse stays open without login.</Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>Auth required</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Driver</Text>
      <Text style={styles.body}>
        Online shell · Accept offers via Supabase Realtime (parity with web DriverHome).
      </Text>
      <View style={styles.pill}>
        <Text style={styles.pillText}>Signed in</Text>
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
