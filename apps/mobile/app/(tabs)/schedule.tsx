import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Colors from '@/constants/Colors';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

const PLACES = [
  { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 },
  { label: 'Cooper Library', lat: 34.6757, lng: -82.8365 },
  { label: 'Core Campus (Tillman)', lat: 34.6784, lng: -82.8397 },
  { label: 'Downtown Clemson', lat: 34.6834, lng: -82.8374 },
  { label: 'Greenville-Spartanburg International (GSP)', lat: 34.8956, lng: -82.2189 },
  { label: 'Charlotte Douglas International (CLT)', lat: 35.2144, lng: -80.9473 },
  { label: 'Hartsfield-Jackson Atlanta (ATL)', lat: 33.6407, lng: -84.4277 },
];

const PURPOSES = [
  { id: 'party_weekend', label: 'Weekend / party' },
  { id: 'airport', label: 'Airport' },
  { id: 'early_class', label: 'Early class' },
  { id: 'planned', label: 'Planned trip' },
];

/** Rider schedule tab — date, time, campus/airport spots, persisted as status scheduled. */
export default function ScheduleScreen() {
  const [purpose, setPurpose] = useState('party_weekend');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [pickup, setPickup] = useState(PLACES[0]);
  const [dropoff, setDropoff] = useState(PLACES[4]);
  const [busy, setBusy] = useState(false);
  const [upcoming, setUpcoming] = useState<Array<{ id: string; pickup_label: string; dropoff_label: string; pickup_at: string; status: string }>>([]);

  async function refresh() {
    if (!isSupabaseConfigured() || !supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) {
      setUpcoming([]);
      return;
    }
    const { data } = await supabase
      .from('trips')
      .select('id, pickup_label, dropoff_label, pickup_at, status')
      .eq('rider_id', userId)
      .eq('status', 'scheduled')
      .order('pickup_at', { ascending: true })
      .limit(12);
    setUpcoming(data || []);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onSchedule() {
    if (!isSupabaseConfigured() || !supabase) {
      Alert.alert('Sign in to book your ride', 'Configure Supabase Auth, then sign in to schedule a ride.');
      return;
    }
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) {
      Alert.alert('Sign in to book your ride', 'Browse freely — sign in to schedule a ride.');
      return;
    }
    if (!date || !time) {
      Alert.alert('Pick a time', 'Enter a date (YYYY-MM-DD) and time (HH:MM).');
      return;
    }
    const when = new Date(`${date}T${time}:00`);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 30 * 60 * 1000) {
      Alert.alert('Pick a later time', 'Schedule at least 30 minutes ahead.');
      return;
    }
    setBusy(true);
    try {
      const iso = when.toISOString();
      const base = (process.env.EXPO_PUBLIC_API_BASE || 'https://clemson-airport-rides.vercel.app').replace(/\/$/, '');
      const token = data.session?.access_token;
      const res = await fetch(`${base}/api/stripe-payment-methods?action=schedule-trip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          pickup,
          dropoff,
          pickupAt: iso,
          purpose,
          tier: 'standard',
        }),
      });
      const payload = await res.json().catch(() => ({})) as { error?: string; message?: string };
      if (!res.ok) throw new Error(payload.error || payload.message || 'Could not schedule ride');
      Alert.alert('Scheduled', 'Drivers can accept this ride. Your first name is all they see before the trip.');
      setDate('');
      setTime('');
      await refresh();
    } catch (err) {
      Alert.alert('Could not schedule', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Schedule</Text>
      <Text style={styles.body}>
        Weekend and party airport or campus trips, early classes, and other planned pickups. Exact pins stay private until the ride is complete.
      </Text>

      <View style={styles.row}>
        {PURPOSES.map((p) => (
          <Pressable key={p.id} onPress={() => setPurpose(p.id)} style={[styles.chip, purpose === p.id && styles.chipOn]}>
            <Text style={[styles.chipText, purpose === p.id && styles.chipTextOn]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
      <TextInput value={date} onChangeText={setDate} placeholder="2026-09-24" style={styles.input} />
      <Text style={styles.label}>Time (HH:MM)</Text>
      <TextInput value={time} onChangeText={setTime} placeholder="07:30" style={styles.input} />

      <Text style={styles.label}>Pickup</Text>
      <View style={styles.row}>
        {PLACES.map((p) => (
          <Pressable key={`pu-${p.label}`} onPress={() => setPickup(p)} style={[styles.chip, pickup.label === p.label && styles.chipOn]}>
            <Text style={[styles.chipText, pickup.label === p.label && styles.chipTextOn]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Drop-off</Text>
      <View style={styles.row}>
        {PLACES.map((p) => (
          <Pressable key={`do-${p.label}`} onPress={() => setDropoff(p)} style={[styles.chip, dropoff.label === p.label && styles.chipPurple]}>
            <Text style={[styles.chipText, dropoff.label === p.label && styles.chipTextOn]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.cta} onPress={onSchedule} disabled={busy}>
        <Text style={styles.ctaText}>{busy ? 'Scheduling…' : 'Schedule ride'}</Text>
      </Pressable>

      <Text style={styles.section}>Your scheduled rides</Text>
      {upcoming.length === 0 ? (
        <Text style={styles.body}>No upcoming rides. Confirm a date and time for a weekend airport or campus trip and it will show up here.</Text>
      ) : (
        upcoming.map((ride) => (
          <View key={ride.id} style={styles.card}>
            <Text style={styles.cardTitle}>{new Date(ride.pickup_at).toLocaleString()}</Text>
            <Text style={styles.body}>{ride.pickup_label} → {ride.dropoff_label}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#fff', gap: 10, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.purple },
  section: { marginTop: 12, fontSize: 18, fontWeight: '800', color: Colors.purple },
  body: { fontSize: 15, lineHeight: 22, color: '#444' },
  label: { marginTop: 6, fontSize: 13, fontWeight: '700', color: Colors.purple },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.25)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.3)',
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  chipPurple: { backgroundColor: Colors.purple, borderColor: Colors.purple },
  chipText: { color: Colors.purple, fontWeight: '700', fontSize: 12 },
  chipTextOn: { color: '#fff' },
  cta: {
    marginTop: 8,
    backgroundColor: Colors.orange,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  ctaText: { color: '#fff', fontWeight: '800' },
  card: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.2)',
  },
  cardTitle: { fontWeight: '800', color: Colors.purple },
});
