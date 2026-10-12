import { useEffect, useRef, useState } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import {
  REBUILT_TITLE_HELPER,
  SALVAGE_TITLE_MESSAGE,
  TITLE_STATUS_OPTIONS,
} from '../../../shared/vehicleTitle.js'
import { useTheme } from '@/lib/theme'

const ORANGE = '#F56600'
const PURPLE = '#522D80'

type TitleChoice = 'clean' | 'rebuilt' | 'salvage'

type Props = {
  value: string
  onChange: (next: TitleChoice) => void
}

function isTitleChoice(value: string): value is TitleChoice {
  switch (value) {
    case 'clean':
    case 'rebuilt':
    case 'salvage':
      return true
    default:
      return false
  }
}

export function TitleStatusField({ value, onChange }: Props) {
  const { colors } = useTheme()
  const reveal = useRef(new Animated.Value(value === 'salvage' ? 1 : 0)).current
  const [showNote, setShowNote] = useState(value === 'salvage')

  useEffect(() => {
    if (value === 'salvage') {
      setShowNote(true)
      const animation = Animated.timing(reveal, {
        toValue: 1,
        duration: 240,
        useNativeDriver: true,
      })
      animation.start()
      return () => animation.stop()
    }
    const animation = Animated.timing(reveal, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    })
    animation.start(({ finished }) => {
      if (finished) setShowNote(false)
    })
    return () => animation.stop()
  }, [reveal, value])

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Vehicle title status" style={styles.wrap}>
      <Text style={[styles.legend, { color: colors.ink }]}>Title status</Text>
      <View style={styles.row}>
        {TITLE_STATUS_OPTIONS.map((option) => {
          const id = String(option.id)
          const selected = value === id
          const salvage = selected && option.allowed === false
          return (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityLabel={`${option.label} title`}
              accessibilityState={{ selected }}
              onPress={() => {
                if (isTitleChoice(id)) onChange(id)
              }}
              style={({ pressed }) => [
                styles.option,
                { backgroundColor: colors.card, borderColor: 'rgba(82, 45, 128, 0.16)' },
                pressed && styles.pressed,
                selected && !salvage && styles.selected,
                salvage && styles.blocked,
              ]}
            >
              <Text style={[styles.label, { color: salvage ? ORANGE : colors.ink }]}>{option.label}</Text>
              <View style={[styles.bar, (selected || salvage) && styles.barOn]} />
            </Pressable>
          )
        })}
      </View>
      <Text style={[styles.help, { color: colors.inkSecondary }]}>{REBUILT_TITLE_HELPER}</Text>
      {showNote ? (
        <Animated.View
          style={{
            opacity: reveal,
            transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
          }}
        >
          <Text accessibilityLiveRegion="polite" style={styles.note}>{SALVAGE_TITLE_MESSAGE}</Text>
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  legend: { fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    minHeight: 64,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 8,
    paddingTop: 14,
    paddingBottom: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pressed: { transform: [{ scale: 0.98 }] },
  selected: {
    borderColor: PURPLE,
    backgroundColor: 'rgba(82, 45, 128, 0.10)',
  },
  blocked: {
    borderColor: ORANGE,
    backgroundColor: 'rgba(245, 102, 0, 0.10)',
  },
  label: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },
  bar: {
    width: '70%',
    height: 3,
    borderRadius: 999,
    backgroundColor: ORANGE,
    opacity: 0,
    transform: [{ scaleX: 0.4 }],
  },
  barOn: { opacity: 1, transform: [{ scaleX: 1 }] },
  help: { fontSize: 13, lineHeight: 18 },
  note: {
    color: '#3d2208',
    backgroundColor: 'rgba(245, 102, 0, 0.10)',
    borderColor: 'rgba(245, 102, 0, 0.35)',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 13,
    lineHeight: 18,
    overflow: 'hidden',
  },
})
