import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppBackdrop, FadeIn, GlassCard, SpringButton } from '@/components/Glass';
import { orange, purple } from '@/constants/Colors';

export default function ScheduleScreen() {
  return (
    <AppBackdrop>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <FadeIn>
          <GlassCard>
            <Text style={styles.kicker}>SCHEDULE</Text>
            <Text style={styles.title}>Your trips</Text>
            <Text style={styles.body}>
              Open without login. When you book, upcoming GSP / ATL / CLT windows show up here.
            </Text>
          </GlassCard>
        </FadeIn>
        <FadeIn delay={80}>
          <GlassCard style={{ marginTop: 12, alignItems: 'center' }}>
            <Text style={styles.empty}>No trips yet</Text>
            <Text style={styles.hint}>Pick a tier on Home, then sign in only to confirm.</Text>
            <View style={{ width: '100%', marginTop: 14 }}>
              <SpringButton label="Browse ride tiers" variant="purple" onPress={() => {}} />
            </View>
          </GlassCard>
        </FadeIn>
      </ScrollView>
    </AppBackdrop>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingTop: 56, paddingBottom: 40 },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 1.2, color: orange, marginBottom: 6 },
  title: { fontSize: 26, fontWeight: '800', color: purple, marginBottom: 8 },
  body: { fontSize: 15, lineHeight: 22, color: '#5B6472' },
  empty: { fontWeight: '800', fontSize: 16, color: purple },
  hint: { marginTop: 6, textAlign: 'center', color: '#5B6472', fontSize: 13, lineHeight: 18 },
});
