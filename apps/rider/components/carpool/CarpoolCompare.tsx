import { LinearGradient } from 'expo-linear-gradient'
import { useMemo } from 'react'
import { Text, View } from 'react-native'
import { formatUsd, surgeDelta, type CarpoolQuote, type Place } from 'rides-native/shared/carpool.js'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

type CompareMode = 'pitch' | 'confirm'

function kicker(mode: CompareMode) {
  switch (mode) {
    case 'pitch':
      return 'WHY CARPOOL'
    case 'confirm':
      return 'BEFORE YOU CONFIRM'
    default: {
      const neverMode: never = mode
      return neverMode
    }
  }
}

export function CarpoolCompare({
  pickup,
  dropoff,
  quote = null,
  selfId = null,
  at,
  mode = 'pitch',
}: {
  pickup: Place | null
  dropoff: Place | null
  quote?: CarpoolQuote | null
  selfId?: string | null
  at?: Date
  mode?: CompareMode
}) {
  const delta = useMemo(
    () => surgeDelta({ pickup, dropoff, quote, selfId, at }),
    [pickup, dropoff, quote, selfId, at],
  )
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  if (!delta) return null

  const chargingNow = mode === 'confirm' && delta.currentShareCents != null
  const fullCarNow = chargingNow
    && delta.currentRiderCount === 4
    && Math.abs((delta.currentShareCents || 0) - delta.fullCarShareCents) <= 75
  const riders = delta.currentRiderCount || 0

  return (
    <LinearGradient
      colors={[colors.orangeSoft, colors.purpleSoft]}
      style={styles.card}
      accessibilityLabel="Carpool price compared with riding alone"
    >
      <Text style={styles.kicker}>{kicker(mode)}</Text>
      <View style={styles.row}>
        <PriceBox label="Alone in surge" amount={formatUsd(delta.soloSurgeCents)} muted />
        <Text style={styles.arrow}>→</Text>
        <PriceBox label="Your seat · 4 riders" amount={formatUsd(delta.fullCarShareCents)} />
      </View>
      <View style={styles.save}>
        <Text style={styles.saveText}>You save {formatUsd(delta.savingsCents)}</Text>
      </View>
      <Text style={styles.driver}>
        Driver earns {formatUsd(delta.driverBonusCents)} more ({formatUsd(delta.driverPayoutCents)} vs {formatUsd(delta.driverSoloPayoutCents)} for one rider).
      </Text>
      {chargingNow && !fullCarNow ? (
        <Text style={styles.charge}>
          This confirm charges {formatUsd(delta.currentShareCents || 0)} each
          {riders ? ` for ${riders} rider${riders === 1 ? '' : 's'}` : ''}.
          {' '}A full car on a surge night is {formatUsd(delta.fullCarShareCents)}.
        </Text>
      ) : null}
      {chargingNow && fullCarNow ? (
        <Text style={styles.charge}>
          This confirm charges {formatUsd(delta.currentShareCents || 0)} each. That is the full-car price above.
        </Text>
      ) : null}
    </LinearGradient>
  )
}

function PriceBox({ label, amount, muted = false }: { label: string; amount: string; muted?: boolean }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={[styles.box, muted ? styles.boxMuted : styles.boxLive]}>
      <Text style={[styles.boxLabel, muted && styles.boxLabelMuted]}>{label}</Text>
      <Text style={[styles.boxAmount, muted && styles.boxAmountMuted]}>{amount}</Text>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    card: {
      marginTop: 16,
      padding: 16,
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: colors.orange,
    },
    kicker: { color: colors.orange, fontSize: 11, fontWeight: '800' as const, letterSpacing: 0.8 },
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 10 },
    arrow: { fontSize: 22, fontWeight: '800' as const, color: colors.orange },
    save: { marginTop: 12, backgroundColor: colors.orange, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
    saveText: { color: colors.onAccent, fontWeight: '800' as const, fontSize: 16 },
    driver: { marginTop: 10, color: colors.link, fontWeight: '700' as const, fontSize: 13, lineHeight: 18 },
    charge: { marginTop: 8, color: colors.ink, fontSize: 13, lineHeight: 18 },
    box: { flex: 1, borderRadius: 14, padding: 12 },
    boxMuted: { backgroundColor: colors.purpleSoft },
    boxLive: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.orange },
    boxLabel: { fontSize: 11, fontWeight: '800' as const, color: colors.orange },
    boxLabelMuted: { color: colors.placeholder },
    boxAmount: { marginTop: 4, fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.5, color: colors.orange },
    boxAmountMuted: { color: colors.inkSecondary, textDecorationLine: 'line-through' as const },
  }
}
