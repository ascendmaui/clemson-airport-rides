import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import {
  PREPAID_TIP_PRESETS_CENTS,
  formatTipDollars,
  parsePrepaidTipDollars,
} from '../../../shared/prepaidTip.js'
import { useTheme } from '@/lib/theme'

type Props = { cents: number; onChange: (cents: number) => void }

/** Optional upfront tip. Held with the fare, 100% to the driver. */
export function TipBoostPicker({ cents, onChange }: Props) {
  const { colors } = useTheme()
  const [custom, setCustom] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [error, setError] = useState('')
  const presetChosen = PREPAID_TIP_PRESETS_CENTS.includes(cents)

  const chip = (label: string, active: boolean, onPress: () => void, a11y: string) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={a11y}
      style={{
        minHeight: 44, minWidth: 56, paddingHorizontal: 14, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: active ? colors.purple : colors.purpleSoft, borderWidth: 1, borderColor: colors.purple,
      }}
    >
      <Text style={{ color: active ? '#FFFFFF' : colors.purple, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  )

  function applyCustom() {
    const parsed = parsePrepaidTipDollars(custom)
    if (!parsed.ok) { setError(parsed.error || 'Enter a tip amount.'); return }
    setError('')
    onChange(parsed.cents ?? 0)
  }

  return (
    <View style={{ gap: 6, marginBottom: 8 }} accessibilityLabel="Tip boost">
      <Text style={{ color: colors.purple, fontWeight: '800' }}>Tip boost (optional)</Text>
      <Text style={{ color: colors.inkSecondary, fontSize: 13 }}>
        Added to your card hold and charged with the fare. 100% goes to your driver. You can still tip after the ride.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {chip('None', cents === 0 && !customOpen, () => { setCustomOpen(false); setError(''); onChange(0) }, 'No tip boost')}
        {PREPAID_TIP_PRESETS_CENTS.map((amount) => chip(
          formatTipDollars(amount), cents === amount && !customOpen,
          () => { setCustomOpen(false); setError(''); onChange(amount) },
          `Tip boost ${formatTipDollars(amount)}`,
        ))}
        {chip(customOpen && cents > 0 && !presetChosen ? formatTipDollars(cents) : 'Custom', customOpen, () => setCustomOpen(true), 'Custom tip boost')}
      </View>
      {customOpen ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput
            value={custom}
            onChangeText={setCustom}
            onSubmitEditing={applyCustom}
            onBlur={applyCustom}
            keyboardType="decimal-pad"
            placeholder="$ amount"
            placeholderTextColor={colors.inkSecondary}
            accessibilityLabel="Custom tip amount in dollars"
            style={{ flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.purple, paddingHorizontal: 12, color: colors.ink }}
          />
        </View>
      ) : null}
      {error ? <Text style={{ color: colors.orange }} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  )
}
