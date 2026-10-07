import { useState } from 'react'
import { Modal, Pressable, Text, TextInput, View } from 'react-native'
import {
  BOOST_INFO_LABEL,
  BOOST_RIDER_HELPER,
  boostHowItWorks,
  riderBoostChosenLine,
} from '../../../shared/copy/boost.js'
import {
  BOOST_PRESETS_CENTS,
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
  const [infoOpen, setInfoOpen] = useState(false)
  const raising = minimumCents > 0
  const how = boostHowItWorks()

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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: colors.purple, fontWeight: '800' }}>{heading}</Text>
        <Pressable
          onPress={() => setInfoOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={BOOST_INFO_LABEL}
          hitSlop={8}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.purpleSoft,
            borderWidth: 1,
            borderColor: colors.purple,
          }}
        >
          <Text style={{ color: colors.purple, fontWeight: '800', fontSize: 16 }}>i</Text>
        </Pressable>
      </View>
      <Text style={{ color: colors.inkSecondary, fontSize: 13, lineHeight: 18 }}>
        {BOOST_RIDER_HELPER}
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
          {riderBoostChosenLine(cents)}
        </Text>
      ) : null}
      {error ? <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text> : null}
      <Modal visible={infoOpen} animationType="slide" transparent onRequestClose={() => setInfoOpen(false)} accessibilityViewIsModal>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim }}>
          <Pressable
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
            onPress={() => setInfoOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close boost help"
          />
          <View style={{ margin: 12, marginBottom: 16, backgroundColor: colors.card, borderRadius: 28, padding: 22, gap: 8 }}>
            <Text style={{ color: colors.purple, fontWeight: '800', fontSize: 22 }}>{how.title}</Text>
            <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>{how.intro}</Text>
            {how.steps.map((step, index) => (
              <Text key={step} style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>
                {index + 1}. {step}
              </Text>
            ))}
            <Pressable
              onPress={() => setInfoOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Got it"
              style={{ marginTop: 8, minHeight: 44, borderRadius: 12, backgroundColor: colors.purple, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: '#fff', fontWeight: '800' }}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}
