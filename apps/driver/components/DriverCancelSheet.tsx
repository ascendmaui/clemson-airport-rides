import { useRef, useState } from 'react'
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { driverCancelTrip } from 'rides-native/driverDesk'
import { DRIVER_CANCEL_NOTICE, DRIVER_CANCEL_REASONS, DRIVER_CANCEL_SUCCESS, validateDriverCancel } from '../../../shared/driverCancel.js'
import { useTheme } from '@/lib/theme'
import { ErrorText, Primary } from '@/components/chrome'

export function DriverCancelSheet({ supabase, tripId, scheduled, disabled, onCanceled }: {
  supabase: unknown; tripId: string; scheduled?: boolean; disabled?: boolean; onCanceled: () => void
}) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const [error, setError] = useState<string | null>(null)
  if (scheduled) return null

  async function confirm() {
    if (sending.current) return
    const invalid = validateDriverCancel(reason, reason === 'other' ? note : undefined)
    if (invalid) { setError(invalid); return }
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      await driverCancelTrip(supabase, tripId, reason, reason === 'other' ? note.trim() : undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel this trip. Try again.')
      sending.current = false
      setBusy(false)
      return
    }
    setOpen(false)
    onCanceled()
    Alert.alert('Trip canceled', DRIVER_CANCEL_SUCCESS)
  }

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Cancel trip" disabled={disabled || busy} onPress={() => setOpen(true)} style={{ padding: 14, alignItems: 'center' }}>
      <Text style={{ color: colors.danger, fontWeight: '700' }}>Cancel trip</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => { if (!busy) setOpen(false) }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim }}>
        <View accessibilityViewIsModal style={{ maxHeight: '90%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20, backgroundColor: colors.card }}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 22, fontWeight: '800' }}>Cancel trip</Text>
            <Text style={{ color: colors.inkSecondary, marginVertical: 12 }}>{DRIVER_CANCEL_NOTICE}</Text>
            {DRIVER_CANCEL_REASONS.map((row: { id: string; label: string }) => <Pressable key={row.id} accessibilityRole="radio" accessibilityLabel={row.label} accessibilityState={{ checked: reason === row.id }} disabled={busy} onPress={() => { setReason(row.id); setError(null) }} style={{ paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: reason === row.id ? colors.purple : colors.ink, fontWeight: reason === row.id ? '800' : '400' }}>{reason === row.id ? '● ' : '○ '}{row.label}</Text>
            </Pressable>)}
            {reason === 'other' ? <>
              <Text style={{ color: colors.ink, marginTop: 12 }}>Note (required, up to 200 characters)</Text>
              <TextInput accessibilityLabel="Cancellation note" value={note} onChangeText={setNote} maxLength={200} editable={!busy} multiline style={{ backgroundColor: colors.input, color: colors.ink, padding: 12, borderRadius: 12, minHeight: 80, marginVertical: 8 }} />
            </> : null}
            {error ? <ErrorText>{error}</ErrorText> : null}
            <Primary label={busy ? 'Canceling…' : 'Confirm cancellation'} disabled={busy || Boolean(disabled) || !reason || (reason === 'other' && !note.trim())} onPress={confirm} />
            <Primary label="Keep trip" tone="ghost" disabled={busy} onPress={() => setOpen(false)} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </>
}
