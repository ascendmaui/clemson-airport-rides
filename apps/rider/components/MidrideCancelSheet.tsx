import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { authedJson } from 'rides-native/apiClient'
import { formatMidrideMoney, midrideChargeSummary } from '../../../shared/midrideQuote.js'
import { PrimaryButton } from '@/components/Button'
import { supabase } from '@/lib/supabase'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

type Abuse = {
  blocked?: boolean
  max?: number
  windowDays?: number
  priorCount?: number
}

type MidrideQuote = {
  ridePortionCents?: number
  cancelFeeCents?: number
  depositPaidCents?: number
  obligationCents?: number
  toCollectCents?: number
  blocked?: boolean
  abuse?: Abuse
}

type CancelPayload = {
  quote?: MidrideQuote
}

function quoteFrom(data: CancelPayload | null | undefined): MidrideQuote | null {
  if (!data) return null
  return (data.quote || data) as MidrideQuote
}

function quoteFromError(err: unknown) {
  if (!err || typeof err !== 'object' || !('payload' in err)) return null
  const payload = (err as { payload?: CancelPayload }).payload
  return quoteFrom(payload)
}

async function requestMidrideCancel(tripId: string, confirm: boolean) {
  return authedJson(supabase, '/api/driver?action=cancel-midride', {
    method: 'POST',
    body: { tripId, confirm },
  }) as Promise<CancelPayload>
}

/**
 * Same confirm flow as the web sheet: preview (confirm omitted / false), then
 * confirm:true. The server still releases the open fare hold and charges the
 * partial fare plus the mid-ride fee.
 */
export function MidrideCancelSheet({
  tripId,
  open,
  onClose,
  onCanceled,
}: {
  tripId: string
  open: boolean
  onClose: () => void
  onCanceled: (data: CancelPayload) => void
}) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [quote, setQuote] = useState<MidrideQuote | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    setLoading(true)
    setError(null)
    setQuote(null)
    requestMidrideCancel(tripId, false)
      .then((data) => {
        if (!alive) return
        setQuote(quoteFrom(data))
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Could not price this cancel')
        const failed = quoteFromError(err)
        if (failed) setQuote(failed)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [open, tripId])

  async function onConfirm() {
    if (!tripId || busy) return
    setBusy(true)
    setError(null)
    try {
      const data = await requestMidrideCancel(tripId, true)
      onCanceled(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not cancel')
      const failed = quoteFromError(err)
      if (failed) setQuote(failed)
    } finally {
      setBusy(false)
    }
  }

  const blocked = Boolean(quote?.blocked || quote?.abuse?.blocked)
  const abuse = quote?.abuse
  const paid = Math.min(quote?.depositPaidCents || 0, quote?.obligationCents || 0)

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => { if (!busy) onClose() }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss cancel" style={styles.backdrop} onPress={() => { if (!busy) onClose() }}>
          <Pressable
            accessibilityLabel="Cancel this ride"
            onPress={() => {}}
            style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom, 16) }]}
          >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.kicker}>CANCEL THIS RIDE</Text>
            <Text style={styles.title}>You will be charged for the trip so far</Text>
            <Text style={styles.body}>
              Canceling after pickup ends the ride for you and your driver. The charge is the distance and time
              already completed, plus a mid-ride cancel fee. This is separate from a wait fee at pickup.
            </Text>
            {loading ? <Text style={styles.muted}>Calculating the charge…</Text> : null}
            {quote && !loading ? (
              <View style={[styles.note, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Row label="Distance and time" value={formatMidrideMoney(quote.ridePortionCents)} colors={colors} />
                <Row label="Mid-ride cancel fee" value={formatMidrideMoney(quote.cancelFeeCents)} colors={colors} />
                {(quote.depositPaidCents || 0) > 0 ? (
                  <Row label="Already paid" value={`−${formatMidrideMoney(paid)}`} colors={colors} />
                ) : null}
                <Row label="Charge now" value={formatMidrideMoney(quote.toCollectCents)} colors={colors} strong />
                <Text style={styles.body}>{midrideChargeSummary(quote)}</Text>
                {abuse ? (
                  <Text style={[styles.abuse, { color: blocked ? colors.danger : colors.purple }]}>
                    {blocked
                      ? `Mid-ride cancel is paused after ${abuse.max} in ${abuse.windowDays} days.`
                      : `${abuse.priorCount} of ${abuse.max} mid-ride cancels used in the last ${abuse.windowDays} days.`}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton
              label={busy ? 'Canceling…' : blocked ? 'Cancel unavailable' : 'Confirm cancel and pay'}
              onPress={() => { void onConfirm() }}
              disabled={loading || busy || blocked || !quote}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Keep riding" onPress={() => { if (!busy) onClose() }} disabled={busy}>
              <Text style={styles.keep}>Keep riding</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function Row({
  label,
  value,
  strong = false,
  colors,
}: {
  label: string
  value: string
  strong?: boolean
  colors: Palette
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 }}>
      <Text style={{ color: strong ? colors.purple : colors.inkSecondary, fontWeight: strong ? '800' : '600', fontSize: strong ? 16 : 14 }}>{label}</Text>
      <Text style={{ color: colors.ink, fontWeight: '800', fontSize: strong ? 16 : 14 }}>{value}</Text>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    backdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: 'rgba(11,18,32,0.45)' },
    sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '88%' as const },
    handle: { alignSelf: 'center' as const, width: 36, height: 4, borderRadius: 2, marginTop: 10 },
    content: { padding: 20, gap: 8 },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.2, fontSize: 13 },
    title: { color: colors.purple, fontSize: 22, fontWeight: '800' as const, letterSpacing: -0.3 },
    body: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    muted: { color: colors.inkSecondary, fontSize: 14 },
    note: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 4 },
    abuse: { fontSize: 12, fontWeight: '700' as const, marginTop: 8 },
    keep: { color: colors.purple, fontWeight: '700' as const, textAlign: 'center' as const, paddingVertical: 12 },
    error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  }
}
