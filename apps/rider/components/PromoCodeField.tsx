import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { checkPromoCode } from 'rides-native/promoCodesClient.js'
import { describePromo, normalizePromoCode } from '../../../shared/promoCodes.js'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'

type Props = {
  /** The normalized code the rider applied, or '' for none. */
  code: string
  onChange: (code: string) => void
}

/**
 * Optional Clemson Rides promo code for this ride. The check here is only a
 * preview: the server prices the ride, applies the one-promo-per-ride rule
 * and reserves the code when the request is sent.
 */
export function PromoCodeField({ code, onChange }: Props) {
  const { colors } = useTheme()
  const [draft, setDraft] = useState(code)
  const [open, setOpen] = useState(Boolean(code))
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  async function apply() {
    const norm = normalizePromoCode(draft)
    if (!norm) { setError('Enter a promo code.'); return }
    setChecking(true)
    setError('')
    setNote('')
    try {
      const res = await checkPromoCode(supabase, { code: norm, side: 'rider' })
      if (res?.ok) {
        onChange(norm)
        setNote(`${describePromo(res)} applies when you request. One promo per ride; if your student or Tiger Pass price is lower, you get that instead and keep this code.`)
      } else {
        onChange('')
        setError(res?.message || 'That code could not be applied.')
      }
    } catch (err) {
      onChange('')
      setError(err instanceof Error ? err.message : 'Could not check that code.')
    } finally {
      setChecking(false)
    }
  }

  function clear() {
    setDraft('')
    setNote('')
    setError('')
    onChange('')
  }

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Add a promo code"
        style={{ minHeight: 44, justifyContent: 'center', marginBottom: 4 }}
      >
        <Text style={{ color: colors.link, fontWeight: '800' }}>Have a promo code?</Text>
      </Pressable>
    )
  }

  return (
    <View style={{ gap: 6, marginBottom: 8 }} accessibilityLabel="Promo code">
      <Text style={{ color: colors.purple, fontWeight: '800' }}>Promo code</Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          value={draft}
          onChangeText={(t) => { setDraft(t.toUpperCase()); setError(''); if (code) onChange('') }}
          placeholder="CODE"
          placeholderTextColor={colors.inkSecondary}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={16}
          accessibilityLabel="Promo code"
          style={{
            flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.purple,
            paddingHorizontal: 12, color: colors.ink, fontWeight: '700', letterSpacing: 1,
          }}
        />
        <Pressable
          onPress={code ? clear : () => { void apply() }}
          disabled={checking}
          accessibilityRole="button"
          accessibilityLabel={code ? 'Remove promo code' : 'Apply promo code'}
          style={{
            minHeight: 44, minWidth: 72, paddingHorizontal: 14, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
            backgroundColor: colors.purple, opacity: checking ? 0.6 : 1,
          }}
        >
          <Text style={{ color: colors.onAccent, fontWeight: '800' }}>{checking ? 'Checking…' : code ? 'Remove' : 'Apply'}</Text>
        </Pressable>
      </View>
      {note && code ? <Text style={{ color: colors.inkSecondary, fontSize: 13 }}>{note}</Text> : null}
      {error ? <Text style={{ color: colors.danger, fontSize: 13 }} accessibilityRole="alert">{error}</Text> : null}
    </View>
  )
}
