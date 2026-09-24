import { LinearGradient } from 'expo-linear-gradient'
import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { formatUsd, surgeDelta, type CarpoolQuote, type Place } from 'rides-native/shared/carpool.js'
import { INK, INK_SECONDARY, ORANGE, PURPLE } from 'rides-native/places.js'

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
  if (!delta) return null

  const chargingNow = mode === 'confirm' && delta.currentShareCents != null
  const fullCarNow = chargingNow
    && delta.currentRiderCount === 4
    && Math.abs((delta.currentShareCents || 0) - delta.fullCarShareCents) <= 75
  const riders = delta.currentRiderCount || 0

  return (
    <LinearGradient
      colors={['rgba(245,102,0,0.16)', 'rgba(82,45,128,0.10)']}
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
  return (
    <View style={[styles.box, muted ? styles.boxMuted : styles.boxLive]}>
      <Text style={[styles.boxLabel, muted && styles.boxLabelMuted]}>{label}</Text>
      <Text style={[styles.boxAmount, muted && styles.boxAmountMuted]}>{amount}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(245,102,0,0.45)',
  },
  kicker: { color: ORANGE, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  arrow: { fontSize: 22, fontWeight: '800', color: ORANGE },
  save: { marginTop: 12, backgroundColor: ORANGE, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  driver: { marginTop: 10, color: PURPLE, fontWeight: '700', fontSize: 13, lineHeight: 18 },
  charge: { marginTop: 8, color: INK, fontSize: 13, lineHeight: 18 },
  box: { flex: 1, borderRadius: 14, padding: 12 },
  boxMuted: { backgroundColor: 'rgba(255,255,255,0.72)' },
  boxLive: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: ORANGE },
  boxLabel: { fontSize: 11, fontWeight: '800', color: ORANGE },
  boxLabelMuted: { color: '#8B939E' },
  boxAmount: { marginTop: 4, fontSize: 26, fontWeight: '800', letterSpacing: -0.5, color: ORANGE },
  boxAmountMuted: { color: INK_SECONDARY, textDecorationLine: 'line-through' },
})
