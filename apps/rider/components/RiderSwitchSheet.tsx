import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { authedJson } from 'rides-native/apiClient'
import { riderSwitchGuide } from '../../../shared/copy/riderSwitch.js'
import { PrimaryButton } from '@/components/Button'
import { supabase } from '@/lib/supabase'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

const GUIDE = riderSwitchGuide()

type DriverChoice = { id: string; name: string; detail?: string }
type TierChoice = { id: string; name: string; fareCents: number | null; available: boolean; current?: boolean }
type SwitchQuote = {
  allowed?: boolean
  feeLine?: string
  holdLine?: string | null
  carpoolLine?: string
  message?: string
}
type SwitchPreview = {
  quote?: SwitchQuote
  drivers?: DriverChoice[]
  tiers?: TierChoice[]
  poolLine?: string | null
}
type SwitchResult = { next?: string; trip?: { id?: string; status?: string } }

function money(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

async function postSwitch(body: Record<string, unknown>) {
  return authedJson(supabase, '/api/rider-switch', { method: 'POST', body }) as Promise<SwitchPreview & SwitchResult>
}

export function RiderSwitchSheet({
  tripId,
  open,
  onClose,
  onDone,
}: {
  tripId: string
  open: boolean
  onClose: () => void
  onDone: (result: SwitchResult) => void
}) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [preview, setPreview] = useState<SwitchPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    setLoading(true)
    setError(null)
    setPreview(null)
    postSwitch({ tripId, confirm: false })
      .then((data) => { if (alive) setPreview(data) })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : 'Could not load this ride') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open, tripId])

  async function confirm(action: string, extra: Record<string, unknown> = {}) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const data = await postSwitch({ tripId, confirm: true, action, ...extra })
      onDone(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update this ride')
    } finally {
      setBusy(false)
    }
  }

  const quote = preview?.quote
  const allowed = Boolean(quote?.allowed)
  const drivers = preview?.drivers || []
  const tiers = preview?.tiers || []

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.backdrop}>
        <Pressable accessibilityRole="none" onPress={() => {}} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: colors.card }]}>
          <View style={[styles.handle, { backgroundColor: colors.track }]} />
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.kicker}>BEFORE PICKUP</Text>
            <Text style={styles.title}>{GUIDE.title}</Text>
            {loading ? <Text style={styles.body}>Checking the fee and the card hold…</Text> : null}
            {quote?.feeLine ? (
              <View style={[styles.note, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Text style={styles.fee}>{quote.feeLine}</Text>
                {quote.holdLine ? <Text style={styles.body}>{quote.holdLine}</Text> : null}
              </View>
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => setShowGuide((value) => !value)}>
              <Text style={styles.link}>{showGuide ? 'Hide how it works' : 'How it works'}</Text>
            </Pressable>
            {showGuide ? GUIDE.summary.map((line) => (
              <Text key={line} style={styles.body}>{line}</Text>
            )) : null}
            {allowed ? (
              <View style={styles.actions}>
                <PrimaryButton label={busy ? 'Updating…' : 'Request another driver'} onPress={() => { void confirm('rerequest') }} disabled={busy} />
                {preview?.poolLine ? <Text style={styles.body}>{preview.poolLine}</Text> : null}
                {drivers.length > 0 ? <Text style={styles.section}>Or pick a driver</Text> : null}
                {drivers.map((driver) => (
                  <Pressable
                    key={driver.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Switch to ${driver.name}`}
                    disabled={busy}
                    onPress={() => { void confirm('switch-driver', { driverId: driver.id }) }}
                    style={[styles.choice, { borderColor: colors.border }]}
                  >
                    <Text style={styles.choiceTitle}>{driver.name}</Text>
                    {driver.detail ? <Text style={styles.body}>{driver.detail}</Text> : null}
                  </Pressable>
                ))}
                <Text style={styles.section}>Or change the ride</Text>
                {tiers.map((tier) => (
                  <Pressable
                    key={tier.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${tier.name}${tier.current ? ', current ride' : ''}${tier.fareCents == null ? '' : `, ${money(tier.fareCents)}`}`}
                    disabled={busy || tier.current || !tier.available || tier.fareCents == null}
                    onPress={() => { void confirm('switch-tier', { tier: tier.id }) }}
                    style={[styles.choice, { borderColor: colors.border, opacity: tier.available ? 1 : 0.45 }]}
                  >
                    <Text style={styles.choiceTitle}>{tier.name}{tier.current ? ' · current' : ''}</Text>
                    <Text style={styles.body}>
                      {tier.fareCents == null ? 'Fare unavailable' : money(tier.fareCents)}
                      {tier.current ? '' : tier.available ? '' : ' · no driver online'}
                    </Text>
                  </Pressable>
                ))}
                {quote?.carpoolLine ? <Text style={styles.body}>{quote.carpoolLine}</Text> : null}
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void confirm('cancel') }}>
                  <Text style={styles.cancel}>Cancel without a new ride</Text>
                </Pressable>
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}>
              <Text style={styles.link}>Close</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function makeStyles(colors: Palette) {
  return {
    backdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: 'rgba(11,18,32,0.45)' },
    sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '88%' as const },
    handle: { alignSelf: 'center' as const, width: 36, height: 4, borderRadius: 2, marginTop: 10 },
    content: { padding: 20, gap: 8 },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.1, fontSize: 11 },
    title: { color: colors.title, fontSize: 22, fontWeight: '800' as const, letterSpacing: -0.3 },
    body: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    fee: { color: colors.ink, fontWeight: '800' as const, fontSize: 16 },
    note: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
    link: { color: colors.link, fontWeight: '800' as const, fontSize: 14 },
    section: { color: colors.title, fontWeight: '800' as const, marginTop: 8 },
    actions: { gap: 8 },
    choice: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 2 },
    choiceTitle: { color: colors.ink, fontWeight: '800' as const },
    cancel: { color: colors.danger, fontWeight: '800' as const, paddingVertical: 8 },
    error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  }
}
