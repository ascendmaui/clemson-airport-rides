import { useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppBackdrop, FadeIn, GlassCard, GlassSheet, MapPin, SpringButton } from '@/components/Glass';
import Colors, { orange, purple } from '@/constants/Colors';
import { isSupabaseConfigured } from '@/lib/supabase';
import { downtownNow } from '@/lib/downtownHeat';

const TIERS = [
  { id: 'tiger', name: 'Tiger', blurb: 'Shared campus van', price: 'From $75 · GSP', accent: 'orange' as const },
  { id: 'purple', name: 'Purple', blurb: 'Private sedan', price: 'From $95 · GSP', accent: 'purple' as const },
  { id: 'tesla', name: 'Tesla Model 3', blurb: 'Clemson fleet · a driver is at the wheel', price: 'From $145 · GSP', accent: 'orange' as const },
];

export default function HomeScreen() {
  const [selected, setSelected] = useState('tesla');
  const [loginOpen, setLoginOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const guest = true;
  const heat = useMemo(() => downtownNow(), []);

  return (
    <AppBackdrop>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <FadeIn>
          <View style={styles.heroMap}>
            <View style={styles.mapWash} />
            <View style={styles.pinRow}>
              <MapPin label="Campus" accent="purple" />
              <View style={styles.routeLine} />
              <MapPin label="GSP" accent="orange" />
            </View>
            <Text style={styles.guestChip}>{guest ? 'Browsing as guest' : 'Signed in'}</Text>
          </View>
        </FadeIn>

        <FadeIn delay={40}>
          <GlassCard style={{ marginBottom: 14 }}>
            <Text style={styles.kicker}>DOWNTOWN TONIGHT</Text>
            <Text style={styles.title}>College Ave is {heat.label}</Text>
            <Text style={styles.subtitle}>
              Typical Fri/Sat night pattern for Tiger Town / Study Hall. Campus pattern, not a live demand feed.
            </Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.round(heat.avg * 100)}%` }]} />
            </View>
          </GlassCard>
        </FadeIn>

        <FadeIn delay={70}>
          <GlassCard style={{ marginBottom: 14 }}>
            <Text style={styles.kicker}>CLEMSON RIDES</Text>
            <Text style={styles.title}>Airport rides, glass-smooth</Text>
            <Text style={styles.subtitle}>
              Browse tiers freely. Sign in only when you book or pay the 25% deposit.
            </Text>
            <Text style={styles.meta}>
              Supabase {isSupabaseConfigured() ? 'ready' : 'needs keys'} · Stripe deposit at checkout
            </Text>
          </GlassCard>
        </FadeIn>

        {TIERS.map((t, i) => (
          <FadeIn key={t.id} delay={80 + i * 50}>
            <GlassCard style={{ marginBottom: 12 }}>
              <View style={styles.tierRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.tierName, { color: t.accent === 'orange' ? orange : purple }]}>{t.name}</Text>
                  <Text style={styles.tierBlurb}>{t.blurb}</Text>
                  <Text style={styles.tierPrice}>{t.price}</Text>
                </View>
                <SpringButton
                  label={selected === t.id ? 'Selected' : 'Select'}
                  variant={selected === t.id ? 'primary' : 'ghost'}
                  onPress={() => setSelected(t.id)}
                />
              </View>
            </GlassCard>
          </FadeIn>
        ))}

        <FadeIn delay={240}>
          <SpringButton label="Book this ride" onPress={() => setLoginOpen(true)} />
          <Text style={styles.hint}>Login required only to confirm & pay</Text>
        </FadeIn>
      </ScrollView>

      <Modal visible={loginOpen} animationType="slide" transparent onRequestClose={() => setLoginOpen(false)}>
        <View style={styles.modalRoot}>
          <GlassSheet>
            <Text style={styles.sheetTitle}>Sign in to book</Text>
            <Text style={styles.sheetBody}>Guests can browse. Booking and the 25% deposit need an account.</Text>
            <TextInput autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor="#8B939E" value={email} onChangeText={setEmail} style={styles.input} />
            <TextInput secureTextEntry placeholder="Password" placeholderTextColor="#8B939E" value={password} onChangeText={setPassword} style={styles.input} />
            <View style={{ gap: 10, marginTop: 8 }}>
              <SpringButton
                label="Continue to deposit"
                onPress={() => {
                  if (!email || !password) {
                    Alert.alert('Sign in', 'Enter email and password to book.');
                    return;
                  }
                  setLoginOpen(false);
                  Alert.alert('Ready', `Tier ${selected} queued — complete checkout on the web if Stripe keys are set.`);
                }}
              />
              <SpringButton label="Keep browsing" variant="ghost" onPress={() => setLoginOpen(false)} />
            </View>
          </GlassSheet>
        </View>
      </Modal>
    </AppBackdrop>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40, paddingTop: 56 },
  heroMap: {
    height: 160,
    borderRadius: 24,
    marginBottom: 16,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(82,45,128,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(82,45,128,0.18)',
  },
  mapWash: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(255,255,255,0.25)' },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeLine: { width: 64, height: 3, borderRadius: 2, backgroundColor: 'rgba(82,45,128,0.45)' },
  guestChip: {
    position: 'absolute',
    top: 12,
    right: 12,
    fontSize: 11,
    fontWeight: '700',
    color: purple,
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 1.2, color: orange, marginBottom: 6 },
  title: { fontSize: 26, fontWeight: '800', color: purple, letterSpacing: -0.4, marginBottom: 8 },
  subtitle: { fontSize: 15, lineHeight: 22, color: '#0B1220', opacity: 0.72 },
  meta: { marginTop: 10, fontSize: 12, color: '#5B6472' },
  barTrack: { height: 8, borderRadius: 999, backgroundColor: 'rgba(82,45,128,0.12)', marginTop: 14, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 999, backgroundColor: orange },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tierName: { fontSize: 18, fontWeight: '800' },
  tierBlurb: { fontSize: 13, color: '#5B6472', marginTop: 2 },
  tierPrice: { fontSize: 14, fontWeight: '700', color: '#0B1220', marginTop: 6 },
  hint: { textAlign: 'center', marginTop: 10, fontSize: 12, color: '#8B939E' },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11,18,32,0.35)' },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: purple, marginBottom: 6 },
  sheetBody: { fontSize: 14, color: '#5B6472', marginBottom: 14, lineHeight: 20 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(82,45,128,0.2)',
    backgroundColor: 'rgba(255,255,255,0.65)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    fontSize: 16,
    color: '#0B1220',
  },
});
