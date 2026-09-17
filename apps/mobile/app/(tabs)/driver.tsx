import { useRef, useState } from 'react';
import { Alert, Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppBackdrop, FadeIn, GlassCard, SpringButton } from '@/components/Glass';
import { orange, purple } from '@/constants/Colors';

const QUEUE = [
  { id: '1', rider: 'Alex · Tiger', route: 'Campus → GSP', when: 'Today 2:40p', fare: '$75' },
  { id: '2', rider: 'Sam · Tesla Autopilot', route: 'Campus → CLT', when: 'Today 5:10p', fare: '$175' },
];

export default function DriverScreen() {
  const [online, setOnline] = useState(true);
  const pulse = useRef(new Animated.Value(1)).current;

  const toggleOnline = () => {
    const next = !online;
    setOnline(next);
    Animated.sequence([
      Animated.spring(pulse, { toValue: 1.08, useNativeDriver: true, friction: 4, tension: 180 }),
      Animated.spring(pulse, { toValue: 1, useNativeDriver: true, friction: 5, tension: 140 }),
    ]).start();
  };

  return (
    <AppBackdrop>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <FadeIn>
          <GlassCard>
            <Text style={styles.kicker}>DRIVER</Text>
            <Text style={styles.title}>Accept rides</Text>
            <Text style={styles.body}>Glass queue with spring accept. Stay online to see new requests.</Text>
            <Animated.View style={{ transform: [{ scale: pulse }], marginTop: 14 }}>
              <SpringButton
                label={online ? 'Online · tap to go offline' : 'Offline · go online'}
                variant={online ? 'primary' : 'ghost'}
                onPress={toggleOnline}
              />
            </Animated.View>
          </GlassCard>
        </FadeIn>

        {QUEUE.map((job, i) => (
          <FadeIn key={job.id} delay={60 + i * 60}>
            <GlassCard style={{ marginTop: 12 }}>
              <Text style={styles.jobRider}>{job.rider}</Text>
              <Text style={styles.jobRoute}>{job.route}</Text>
              <Text style={styles.jobMeta}>{job.when} · {job.fare}</Text>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <SpringButton
                    label="Accept"
                    onPress={() => Alert.alert('Accepted', `${job.rider} locked in.`)}
                    disabled={!online}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <SpringButton label="Skip" variant="ghost" onPress={() => {}} />
                </View>
              </View>
            </GlassCard>
          </FadeIn>
        ))}
      </ScrollView>
    </AppBackdrop>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingTop: 56, paddingBottom: 40, gap: 4 },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 1.2, color: orange, marginBottom: 6 },
  title: { fontSize: 26, fontWeight: '800', color: purple, marginBottom: 8 },
  body: { fontSize: 15, lineHeight: 22, color: '#5B6472' },
  jobRider: { fontSize: 17, fontWeight: '800', color: purple },
  jobRoute: { marginTop: 4, fontSize: 14, color: '#0B1220' },
  jobMeta: { marginTop: 4, marginBottom: 12, fontSize: 13, color: '#5B6472' },
  row: { flexDirection: 'row', gap: 10 },
});
