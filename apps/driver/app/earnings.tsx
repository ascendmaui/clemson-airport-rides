import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BackButton, Card, ErrorText } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { formatCents, loadEarnings } from 'rides-native/driverDesk'
import { driverNetCents } from 'rides-native/tripTags'
import { INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'

type EarningsState = Awaited<ReturnType<typeof loadEarnings>> | null

export default function EarningsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const [data, setData] = useState<EarningsState>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    setData(await loadEarnings(supabase, user.id))
  }, [user])

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load earnings'))
  }, [refresh])

  const summary = data?.summary
  const payouts = data?.payouts

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <ScrollView contentContainerStyle={styles.list}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.kicker}>EARNINGS</Text>
        <Text style={styles.title}>Deposits and your 80%</Text>
        <Text style={styles.copy}>
          Airport bookings collect a 25% Stripe deposit on the web. This screen reads /api/driver earnings and payouts with your Supabase session. Card numbers stay on the server.
        </Text>
        {!user ? <Text style={styles.copy}>Sign in to see your trips.</Text> : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        {data?.apiError ? <ErrorText>{`Deposit rows: ${data.apiError}`}</ErrorText> : null}
        {data?.payoutError ? <ErrorText>{`Payout status: ${data.payoutError}`}</ErrorText> : null}
        <View style={styles.stats}>
          <Stat label="Today" value={formatCents(summary?.todayNetCents || 0)} />
          <Stat label="Your net" value={formatCents(summary?.driverNetCents || 0)} />
          <Stat label="Deposits paid" value={formatCents(summary?.depositPaidCents || 0)} />
          <Stat label="Deposits open" value={formatCents(summary?.depositOpenCents || 0)} />
        </View>
        <Card>
          <Text style={styles.cardTitle}>Payouts</Text>
          <Text style={styles.copy}>
            Paid {formatCents(Number(payouts?.paidCents) || 0)} · pending {formatCents(Number(payouts?.pendingCents) || 0)}. Failed payouts stay pending and retry from the web cron.
          </Text>
        </Card>
        {(summary?.lines || []).map((line) => (
          <Card key={line.tripId}>
            <Text style={styles.cardTitle}>{line.dropoff}</Text>
            <Text style={styles.copy}>{line.line}</Text>
            <Text style={styles.copy}>Fare {formatCents(line.fareCents)} · you net {formatCents(driverNetCents(line.fareCents))}</Text>
          </Card>
        ))}
        {(data?.trips || []).slice(0, 12).map((trip) => (
          <View key={trip.id} style={styles.row}>
            <Text style={styles.rowLabel}>{trip.dropoff_label || trip.pickup_label || 'Trip'}</Text>
            <Text style={styles.rowValue}>{formatCents(driverNetCents(Number(trip.fare_cents) || 0))}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  list: { padding: 16, gap: 12, paddingBottom: 40 },
  kicker: { color: ORANGE, fontWeight: '800', letterSpacing: 1.1, fontSize: 12, marginTop: 8 },
  title: { fontSize: 28, fontWeight: '800', color: PURPLE },
  copy: { color: INK_SECONDARY, fontSize: 14, lineHeight: 20 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '48%', backgroundColor: '#fff', borderRadius: 18, padding: 14 },
  statLabel: { color: INK_SECONDARY, fontSize: 12, fontWeight: '700' },
  statValue: { color: PURPLE, fontSize: 20, fontWeight: '800', marginTop: 4 },
  cardTitle: { color: PURPLE, fontWeight: '800', fontSize: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  rowLabel: { color: INK, fontWeight: '600', flex: 1 },
  rowValue: { color: PURPLE, fontWeight: '800' },
})
