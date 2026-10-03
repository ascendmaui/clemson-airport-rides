import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RequireAuth } from '@/components/RequireAuth'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { supabase } from '@/lib/supabase'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import {
  FARE_UNKNOWN_TIP_NOTE,
  customTipCents,
  formatTipCents,
  tipChargeBody,
  tipPresetView,
} from 'rides-native/tipPresets.js'
import { submitTripTip } from 'rides-native/tipRide.js'

type TipTrip = {
  id: string
  status: string | null
  fare_cents: number | null
  tip_cents: number | null
  pickup_label: string | null
  dropoff_label: string | null
}

function TipScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ trip?: string }>()
  const tripId = oneParam(params.trip)
  const { user } = useAuth()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [trip, setTrip] = useState<TipTrip | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paidCents, setPaidCents] = useState<number | null>(null)
  const [owedCents, setOwedCents] = useState<number | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [custom, setCustom] = useState('')

  useEffect(() => {
    if (!tripId || !supabase || !user?.id) return undefined
    let alive = true
    supabase
      .from('trips')
      .select('id, status, fare_cents, tip_cents, pickup_label, dropoff_label')
      .eq('id', tripId)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (!alive) return
        if (queryError) setError(queryError.message)
        else setTrip((data as TipTrip | null) || null)
        setLoaded(true)
      })
    return () => { alive = false }
  }, [tripId, user?.id])

  const presets = tipPresetView(trip?.fare_cents)
  const fareKnown = presets.some((row) => row.cents != null)
  const existing = Number(trip?.tip_cents) > 0 ? Number(trip?.tip_cents) : 0
  const shownPaid = paidCents || existing

  async function charge(choice: { percent?: number; customCents?: number }) {
    if (!tripId || !supabase) return
    setBusy(true)
    setError(null)
    try {
      const result = await submitTripTip(supabase, tipChargeBody({ tripId, ...choice }))
      if (result?.ok) {
        setPaidCents(Number(result.tipCents) || 0)
        setOwedCents(result.driverEarningsCents == null ? null : Number(result.driverEarningsCents))
        return
      }
      if (result?.needsPaymentMethod || result?.requiresAction) {
        setError('Add the card you use for the 25% deposit, then try this tip again.')
        return
      }
      setError(result?.error || 'Tip was not charged.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Tip was not charged.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  function sendCustom() {
    const parsed = customTipCents(custom)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    void charge({ customCents: parsed.cents })
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: 20, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }}
    >
      <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={16} onPress={() => router.back()}>
        <Text style={styles.back}>← Back</Text>
      </Pressable>
      <View style={[styles.card, lift(colors, 'rest')]}>
        <Text style={styles.kicker}>OPTIONAL</Text>
        <Text style={styles.title}>Add a tip</Text>
        {trip?.pickup_label ? (
          <Text style={styles.body}>{trip.pickup_label} → {trip.dropoff_label}</Text>
        ) : null}
        {!tripId ? (
          <Text style={styles.body}>This tip needs a completed ride.</Text>
        ) : !loaded ? (
          <Text style={styles.body}>Loading this ride…</Text>
        ) : shownPaid ? (
          <View>
            <Text style={styles.done}>Tip of {formatTipCents(shownPaid)} added for your driver.</Text>
            {owedCents != null ? (
              <Text style={styles.body}>
                {formatTipCents(owedCents)} is owed to your driver and included in their earnings.
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.stack}>
            <Text style={styles.body}>
              {fareKnown
                ? `Fare ${formatTipCents(trip?.fare_cents)}. Choose a percent of that fare. You can skip.`
                : `${FARE_UNKNOWN_TIP_NOTE} A custom amount is still optional.`}
            </Text>
            {fareKnown && presets.every((row) => !row.chargeable) ? (
              <Text style={styles.body}>Those percents are outside $1 to $100. Use a custom amount instead.</Text>
            ) : null}
            {presets.map((row) => (
              <Pressable
                key={row.percent}
                accessibilityRole="button"
                accessibilityLabel={row.accessibilityLabel}
                accessibilityState={{ disabled: busy || !row.chargeable }}
                disabled={busy || !row.chargeable}
                onPress={() => { void charge({ percent: row.percent }) }}
                style={[styles.preset, !row.chargeable && styles.presetOff]}
              >
                <Text style={styles.presetLabel}>{row.label}</Text>
                <Text style={styles.presetDetail}>{row.detail || 'Fare needed'}</Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Custom amount"
              disabled={busy}
              onPress={() => setCustomOpen((open) => !open)}
              hitSlop={10}
            >
              <Text style={styles.custom}>Custom amount</Text>
            </Pressable>
            {customOpen ? (
              <View style={styles.customRow}>
                <TextInput
                  value={custom}
                  onChangeText={setCustom}
                  keyboardType="decimal-pad"
                  placeholder="8.00"
                  placeholderTextColor={colors.placeholder}
                  accessibilityLabel="Custom tip in dollars"
                  style={styles.input}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add custom tip"
                  disabled={busy}
                  onPress={sendCustom}
                  style={styles.customAdd}
                >
                  <Text style={styles.customAddLabel}>Add</Text>
                </Pressable>
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="No tip"
              disabled={busy}
              onPress={() => router.replace('/')}
            >
              <Text style={styles.skip}>{busy ? 'Sending tip…' : 'No tip'}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    back: { color: colors.link, fontSize: 13, fontWeight: '800' as const, marginBottom: 12 },
    card: {
      backgroundColor: colors.card,
      borderRadius: 22,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 8,
    },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.2, fontSize: 12 },
    title: { color: colors.title, fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.4 },
    body: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    stack: { gap: 8, marginTop: 4 },
    preset: {
      minHeight: 52,
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderWidth: 1.5,
      borderColor: colors.purple,
      backgroundColor: colors.purpleSoft,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
    },
    presetOff: { opacity: 0.55 },
    presetLabel: { color: colors.purple, fontSize: 18, fontWeight: '800' as const },
    presetDetail: { color: colors.orange, fontSize: 18, fontWeight: '800' as const },
    custom: { color: colors.inkSecondary, fontSize: 13, fontWeight: '700' as const, paddingVertical: 6 },
    customRow: { flexDirection: 'row' as const, gap: 8, alignItems: 'center' as const },
    input: {
      flex: 1,
      minHeight: 44,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      color: colors.purple,
      fontWeight: '700' as const,
      backgroundColor: colors.input,
    },
    customAdd: {
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 12,
      justifyContent: 'center' as const,
      backgroundColor: colors.purpleSoft,
      borderWidth: 1,
      borderColor: colors.border,
    },
    customAddLabel: { color: colors.purple, fontWeight: '800' as const, fontSize: 13 },
    skip: { textAlign: 'center' as const, color: colors.inkSecondary, fontWeight: '700' as const, paddingVertical: 12 },
    done: { color: colors.purple, fontWeight: '800' as const, fontSize: 16 },
    error: { color: colors.danger, fontSize: 13 },
  }
}

export default function TipRoute() {
  return (
    <RequireAuth>
      <TipScreen />
    </RequireAuth>
  )
}
