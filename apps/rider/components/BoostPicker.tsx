import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import {
  BOOST_MAX_CENTS,
  BOOST_PRESETS_CENTS,
  BOOST_RIDER_COPY,
  formatBoostDollars,
  parseBoostDollars,
} from '../../../shared/scheduledBoost.js'
import { useTheme } from '@/lib/theme'

type Props = {
  cents: number
  onChange: (cents: number) => void
  minimumCents?: number
  heading?: string
}

export function BoostPicker({ cents, onChange, minimumCents = 0, heading = 'Driver boost' }: Props) {
  const { colors } = useTheme()
  const [custom, setCustom] = useState('')
  const [error, setError] = useState('')
  const raising = minimumCents > 0

  function choose(next: number) {
    setError('')
    setCustom('')
    onChange(next)
  }

  function applyCustom() {
    const parsed = parseBoostDollars(custom)
    if (!parsed.ok) {
      setError(parsed.error || 'Enter a boost amount.')
      return
    }
    if (parsed.cents < minimumCents) {
      setError(raising ? 'Raise the boost above the current amount.' : 'Enter a boost amount.')
      return
    }
    setError('')
    onChange(parsed.cents)
  }

  const choices = [
    ...(raising ? [] : [0]),
    ...BOOST_PRESETS_CENTS.filter((amount) => amount >= minimumCents),
  ]

  return (
    <View style={{ marginTop: 12, gap: 8 }} accessibilityLabel={heading}>
      <Text style={{ color: colors.purple, fontWeight: '800' }}>{heading}</Text>
      <Text style={{ color: colors.inkSecondary, fontSize: 13, lineHeight: 18 }}>
        {BOOST_RIDER_COPY} Up to {formatBoostDollars(BOOST_MAX_CENTS)}.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {choices.map((amount) => {
          const on = cents === amount
          const label = amount === 0 ? 'No boost' : `+${formatBoostDollars(amount)}`
          return (
            <Pressable
              key={amount}
              onPress={() => choose(amount)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={label}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: on ? '#F56600' : colors.purpleSoft,
                borderWidth: 1,
                borderColor: on ? '#F56600' : colors.border,
              }}
            >
              <Text style={{ color: on ? '#fff' : colors.purple, fontWeight: '700' }}>{label}</Text>
            </Pressable>
          )
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          value={custom}
          onChangeText={setCustom}
          placeholder="Custom $"
          placeholderTextColor={colors.placeholder}
          keyboardType="decimal-pad"
          accessibilityLabel="Custom boost in dollars"
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: colors.ink,
            backgroundColor: colors.input,
          }}
        />
        <Pressable
          onPress={applyCustom}
          accessibilityRole="button"
          accessibilityLabel="Set custom boost"
          style={{ backgroundColor: colors.purple, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 }}
        >
          <Text style={{ color: '#fff', fontWeight: '800' }}>Set</Text>
        </Pressable>
      </View>
      {cents > 0 ? (
        <Text style={{ color: '#F56600', fontWeight: '800' }}>
          Boost {formatBoostDollars(cents)} · your driver keeps all of it
        </Text>
      ) : null}
      {error ? <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text> : null}
    </View>
  )
}
