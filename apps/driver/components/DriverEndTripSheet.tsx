import { useRef, useState } from 'react'
import { showToast } from 'rides-native/toastStore.js'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { driverEndTrip } from 'rides-native/driverDesk'
import {
  DRIVER_END_CONFIRM,
  DRIVER_END_LABEL,
  DRIVER_END_NOTICE,
  DRIVER_END_REASONS,
  DRIVER_END_SUCCESS,
  DRIVER_END_TITLE,
  validateDriverEnd,
} from '../../../shared/driverEndTrip.js'
import { useTheme } from '@/lib/theme'
import { ErrorText, Primary } from '@/components/chrome'

export function DriverEndTripSheet({ supabase, tripId, disabled, onEnded }: {
  supabase: unknown
  tripId: string
  disabled?: boolean
  onEnded: () => void
}) {
  const { colors } = useTheme()
  const light = colors.statusBar === 'dark'
  const selectedColor = light ? '#522D80' : '#E6D4FF'
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (sending.current) return
    const invalid = validateDriverEnd(reason, reason === 'other' ? note : undefined)
    if (invalid) { setError(invalid); return }
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      await driverEndTrip(supabase, tripId, reason, reason === 'other' ? note.trim() : undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not end this trip. Try again.')
      sending.current = false
      setBusy(false)
      return
    }
    setOpen(false)
    onEnded()
    showToast({ key: 'driver-ended-self', tone: 'warning', title: 'Trip ended', body: DRIVER_END_SUCCESS })
  }

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={DRIVER_END_LABEL} disabled={disabled || busy} onPress={() => setOpen(true)} style={{ minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 15, letterSpacing: -0.1 }}>{DRIVER_END_LABEL}</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => { if (!busy) setOpen(false) }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim }}>
        <View accessibilityViewIsModal style={{ maxHeight: '90%', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, paddingBottom: insets.bottom + 16, backgroundColor: colors.card, shadowColor: '#1A1033', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: -8 }, elevation: 12 }}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View accessible={false} style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 14 }} />
            <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 22, fontWeight: '700', letterSpacing: -0.4 }}>{DRIVER_END_TITLE}</Text>
            <Text style={{ color: colors.inkSecondary, marginTop: 8, marginBottom: 14, fontSize: 15, lineHeight: 21 }}>{DRIVER_END_NOTICE}</Text>
            {DRIVER_END_REASONS.map((row: { id: string; label: string }) => <Pressable key={row.id} accessibilityRole="radio" accessibilityLabel={row.label} accessibilityState={{ checked: reason === row.id }} disabled={busy} onPress={() => { setReason(row.id); setError(null) }} style={{ minHeight: 48, justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14, marginBottom: 6, backgroundColor: reason === row.id ? (light ? 'rgba(82,45,128,0.10)' : 'rgba(230,212,255,0.14)') : 'transparent' }}>
              <Text style={{ color: reason === row.id ? selectedColor : colors.ink, fontWeight: reason === row.id ? '700' : '500', fontSize: 16, letterSpacing: -0.2 }}>{reason === row.id ? '● ' : '○ '}{row.label}</Text>
            </Pressable>)}
            {reason === 'other' ? <>
              <Text style={{ color: colors.ink, marginTop: 8, fontSize: 14, fontWeight: '600' }}>Note (required, up to 200 characters)</Text>
              <TextInput accessibilityLabel="Problem note" value={note} onChangeText={setNote} maxLength={200} editable={!busy} multiline style={{ backgroundColor: colors.input, color: colors.ink, padding: 14, borderRadius: 16, minHeight: 88, marginTop: 8, marginBottom: 8, borderWidth: 1, borderColor: colors.border, fontSize: 16, lineHeight: 22 }} />
            </> : null}
            {error ? <ErrorText>{error}</ErrorText> : null}
            <Primary label={busy ? 'Ending…' : DRIVER_END_CONFIRM} disabled={busy || Boolean(disabled) || !reason || (reason === 'other' && !note.trim())} onPress={confirm} />
            <Primary label="Keep trip" tone="ghost" disabled={busy} onPress={() => setOpen(false)} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </>
}
