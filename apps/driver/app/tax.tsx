import { LinearGradient } from 'expo-linear-gradient'
import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { shownCents } from '@/lib/shown'
import { supabase } from '@/lib/supabase'
import { exportYearEnd, type ExportKind } from '@/lib/taxExport'
import { loadYearEnd, type YearEndView } from '@/lib/taxPacket'
import { useTheme } from '@/lib/theme'
import { elevation, radius, type as typeScale } from 'rides-native/shared/theme.js'
import { loadDriverW9 } from 'rides-native/driverW9Client'
import { w9StatusLabel } from '../../../shared/driverW9.js'

function milesText(miles: number | null | undefined): string {
  if (miles == null) return '—'
  return `${Number(miles).toFixed(2)} mi`
}

function moneyText(cents: number | null, hidden: boolean, empty = '—'): string {
  if (hidden) return '••••'
  if (cents == null) return empty
  return shownCents(cents, false)
}

export default function TaxScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const { colors, earningsPrivate } = useTheme()
  const [packet, setPacket] = useState<YearEndView | null>(null)
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [w9Status, setW9Status] = useState('Not on file')
  const [ready, setReady] = useState(!user)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<ExportKind | null>(null)

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const [desk, view] = await Promise.all([
      loadDriverW9(supabase, user.id),
      loadYearEnd(supabase, user.id, selectedYear),
    ])
    setW9Status(w9StatusLabel(desk))
    setPacket(view)
    setError(null)
  }, [selectedYear, user])

  useFocusEffect(useCallback(() => {
    if (!user) {
      setReady(true)
      return undefined
    }
    let alive = true
    refresh()
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load tax info')
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [refresh, user]))

  async function save(kind: ExportKind) {
    if (!packet) return
    setBusy(kind)
    setError(null)
    try {
      await exportYearEnd(kind, packet)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export the tax summary')
    } finally {
      setBusy(null)
    }
  }

  function openLink(url: string) {
    Linking.openURL(url).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not open the link')
    })
  }

  const deduction = packet?.estimatedDeductionCents
  const enrouteHint = packet?.enrouteUntrackedTrips
    ? `Not tracked on ${packet.enrouteUntrackedTrips} completed ${packet.enrouteUntrackedTrips === 1 ? 'trip' : 'trips'}`
    : 'Counted when a pickup route or accept location was saved'

  return (
    <StackPage title="Tax info" onBack={() => router.back()}>
      {!user ? (
        <Card>
          <Text style={{ color: colors.title, fontWeight: '800' }}>Sign in for your year-end summary</Text>
          <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
            Gross earnings, tips, platform fees, payouts, and deductible miles appear after you sign in.
          </Text>
          <Primary label="Sign in" onPress={() => router.push('/sign-in')} />
        </Card>
      ) : null}
      {user && !ready ? (
        <Card>
          <Text style={{ color: colors.title, fontWeight: '800' }}>Loading tax summary</Text>
          <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>Adding up this year’s trips, payouts, and miles.</Text>
        </Card>
      ) : null}
      {user && ready && packet ? (
        <>
          <LinearGradient
            colors={[colors.purple, colors.orange]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <Text style={styles.heroKicker}>{packet.year} ESTIMATE</Text>
            <Text style={styles.heroAmount}>{moneyText(deduction ?? null, earningsPrivate, 'Rate not configured')}</Text>
            <Text style={styles.heroLabel}>Estimated mileage deduction</Text>
            <Text style={styles.heroNote}>{packet.rateLabel}</Text>
          </LinearGradient>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.years}>
            {packet.years.map((item) => {
              const active = item === packet.year
              return (
                <Pressable
                  key={item}
                  onPress={() => setSelectedYear(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item} tax year`}
                  accessibilityState={{ selected: active }}
                  style={[styles.year, { backgroundColor: active ? colors.purple : colors.card }]}
                >
                  <Text style={{ color: active ? colors.onAccent : colors.purple, fontWeight: '800' }}>{item}</Text>
                </Pressable>
              )
            })}
          </ScrollView>
          <Card>
            <Text style={[styles.kicker, { color: colors.orange }]}>THIS YEAR</Text>
            <View style={styles.grid}>
              <Stat label="Gross earnings" value={moneyText(packet.grossEarningsCents, earningsPrivate)} />
              <Stat label="Tips" value={moneyText(packet.tipsCents, earningsPrivate, 'Not tracked')} />
              <Stat label="Platform fees" value={moneyText(packet.platformFeeCents, earningsPrivate)} />
              <Stat label="Payouts" value={moneyText(packet.payoutsCents, earningsPrivate)} hint="Paid transfers for this year’s trips" />
              <Stat label="On-trip miles" value={milesText(packet.onTripMiles)} />
              <Stat label="En route to pickup" value={milesText(packet.enrouteMiles)} hint={enrouteHint} />
              <Stat label="Deductible miles" value={milesText(packet.deductibleMiles)} />
              <Stat label="Trips" value={String(packet.earningsTripCount)} />
            </View>
            {packet.pendingPayoutCents > 0 ? (
              <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
                Pending payouts {moneyText(packet.pendingPayoutCents, earningsPrivate)} are not in the payout total.
              </Text>
            ) : null}
            {earningsPrivate ? (
              <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
                Amounts are hidden on this phone. Turn off Make earnings private in Settings to see them.
              </Text>
            ) : null}
            {packet.sourceNote ? <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{packet.sourceNote}</Text> : null}
          </Card>
          <View style={styles.actions}>
            <View style={styles.action}>
              <Primary
                label={busy === 'csv' ? 'Saving CSV…' : 'Download CSV'}
                onPress={() => { void save('csv') }}
                disabled={Boolean(busy)}
                accessibilityLabel="Download CSV mileage log and earnings summary"
              />
            </View>
            <View style={styles.action}>
              <Primary
                label={busy === 'pdf' ? 'Saving PDF…' : 'Download PDF'}
                tone="purple"
                onPress={() => { void save('pdf') }}
                disabled={Boolean(busy)}
                accessibilityLabel="Download PDF mileage log and earnings summary"
              />
            </View>
          </View>
          <Card>
            <Text style={{ color: colors.title, fontWeight: '800' }}>Not tax advice</Text>
            <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{packet.disclaimer}</Text>
            <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{packet.mileageEstimateNote}</Text>
            <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{packet.stripe1099Note}</Text>
            <Pressable
              onPress={() => openLink(packet.stripe1099Url)}
              accessibilityRole="link"
              accessibilityLabel="Open 1099 forms in Stripe"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={{ color: colors.purple, fontWeight: '800' }}>Open 1099 forms in Stripe</Text>
            </Pressable>
            <Pressable
              onPress={() => openLink(packet.form1099InfoUrl)}
              accessibilityRole="link"
              accessibilityLabel="1099 info"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={{ color: colors.orange, fontWeight: '800' }}>1099 info</Text>
            </Pressable>
            <Pressable
              onPress={() => openLink(packet.stripeTaxReportingUrl)}
              accessibilityRole="link"
              accessibilityLabel="How Stripe files 1099 forms"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={{ color: colors.purple, fontWeight: '800' }}>How Stripe files them</Text>
            </Pressable>
          </Card>
          <Card>
            <Text style={[styles.kicker, { color: colors.orange }]}>YEARLY EARNINGS SUMMARY</Text>
            <Text style={{ color: colors.title, fontWeight: '800', fontSize: 18 }}>
              {packet.year === packet.years[0] ? `${packet.year} to date` : packet.year}
            </Text>
            <View style={styles.grid}>
              <Stat label="Gross fares" value={moneyText(packet.grossFareCents, earningsPrivate)} />
              <Stat label="Tips (100% yours)" value={moneyText(packet.tipsCents, earningsPrivate, 'Not tracked')} />
              <Stat label="Platform fees" value={moneyText(packet.platformFeeCents, earningsPrivate)} />
              <Stat label="Bonuses and perks" value={moneyText(packet.bonusPerkCents, earningsPrivate)} />
              <Stat label="Net payouts" value={moneyText(packet.netPayoutCents, earningsPrivate)} hint="Paid transfers for this year’s trips" />
            </View>
            <Text style={{ color: colors.title, fontWeight: '800' }}>Monthly breakdown</Text>
            {packet.months.length === 0 ? (
              <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>No months in this year yet.</Text>
            ) : packet.months.map((month) => (
              <View key={month.month} style={styles.month}>
                <Text style={{ color: colors.ink, fontWeight: '800' }}>{month.label}</Text>
                <Text style={{ color: colors.inkSecondary, lineHeight: 18 }}>
                  Fares {moneyText(month.grossFareCents, earningsPrivate)} · Tips {moneyText(month.tipsCents, earningsPrivate)} · Fees {moneyText(month.platformFeeCents, earningsPrivate)} · Bonuses {moneyText(month.bonusPerkCents, earningsPrivate)} · Net {moneyText(month.netCents, earningsPrivate)}
                </Text>
              </View>
            ))}
            {packet.taxEstimate ? (
              <View style={styles.month}>
                <Text style={{ color: colors.title, fontWeight: '800' }}>Tax estimate</Text>
                <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
                  Mileage deduction {moneyText(packet.estimatedDeductionCents, earningsPrivate, 'Rate not configured')}. Taxable after that deduction {moneyText(packet.taxEstimate.taxableEarningsCents, earningsPrivate)}. Estimated self-employment tax {moneyText(packet.taxEstimate.selfEmploymentTaxCents, earningsPrivate)}. Quarterly set-aside {moneyText(packet.taxEstimate.quarterlySetAsideCents, earningsPrivate)}.
                </Text>
                <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{packet.taxEstimate.note}</Text>
              </View>
            ) : null}
          </Card>
        </>
      ) : null}
      <Card>
        <Text style={{ color: colors.title, ...typeScale.cardTitle }}>W-9</Text>
        <Text style={{ color: colors.inkSecondary, ...typeScale.body }}>
          {w9Status} Stripe issues the 1099. This app does not generate that form.
        </Text>
      </Card>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Primary
        label="Update W-9"
        tone="ghost"
        onPress={() => router.push('/w9')}
        accessibilityLabel="Update W-9"
        accessibilityRole="link"
      />
    </StackPage>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const { colors } = useTheme()
  return (
    <View style={styles.stat}>
      <Text style={{ color: colors.inkSecondary, fontSize: 12, fontWeight: '700' }}>{label}</Text>
      <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '800' }}>{value}</Text>
      {hint ? <Text style={{ color: colors.inkSecondary, fontSize: 12, lineHeight: 16 }}>{hint}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: radius.sheet,
    padding: 22,
    gap: 4,
    shadowColor: '#522D80',
    shadowOpacity: elevation.float.shadowOpacity,
    shadowRadius: elevation.float.shadowRadius,
    shadowOffset: { width: elevation.float.shadowOffset.width, height: elevation.float.shadowOffset.height },
    elevation: elevation.float.elevation,
  },
  heroKicker: { color: '#FFFFFF', ...typeScale.kicker, opacity: 0.9 },
  heroAmount: { color: '#FFFFFF', fontSize: 36, fontWeight: '800', letterSpacing: -1 },
  heroLabel: { color: '#FFFFFF', fontWeight: '700' },
  heroNote: { color: '#FFFFFF', fontSize: 12, lineHeight: 17, opacity: 0.92 },
  years: { gap: 8, paddingVertical: 2 },
  year: { borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  kicker: { ...typeScale.kicker },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  stat: { width: '46%', gap: 2 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
  month: { gap: 2 },
})
