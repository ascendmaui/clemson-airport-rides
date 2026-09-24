import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ORANGE, PURPLE } from 'rides-native/places.js'

type ButtonTone = 'orange' | 'purple' | 'ghost' | 'outline'

function toneStyle(tone: ButtonTone) {
  switch (tone) {
    case 'orange':
      return { backgroundColor: ORANGE, color: '#fff', borderColor: 'transparent', borderWidth: 0 }
    case 'purple':
      return { backgroundColor: PURPLE, color: '#fff', borderColor: 'transparent', borderWidth: 0 }
    case 'ghost':
      return { backgroundColor: 'rgba(255,255,255,0.7)', color: PURPLE, borderColor: 'transparent', borderWidth: 0 }
    case 'outline':
      return {
        backgroundColor: 'rgba(82,45,128,0.06)',
        color: PURPLE,
        borderColor: 'rgba(82,45,128,0.35)',
        borderWidth: 1.5,
      }
    default: {
      const neverTone: never = tone
      return neverTone
    }
  }
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  tone = 'orange',
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  tone?: ButtonTone
}) {
  const look = toneStyle(tone)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[
        styles.btn,
        {
          backgroundColor: look.backgroundColor,
          borderColor: look.borderColor,
          borderWidth: look.borderWidth,
          opacity: disabled ? 0.55 : 1,
        },
      ]}
    >
      <Text style={[styles.label, { color: look.color }]}>{label}</Text>
    </Pressable>
  )
}

export function Pill({
  label,
  active,
  onPress,
}: {
  label: string
  active?: boolean
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active && styles.pillOn]} accessibilityRole="button">
      <Text style={[styles.pillLabel, active && styles.pillLabelOn]}>{label}</Text>
    </Pressable>
  )
}

export function SheetHandle() {
  return <View style={styles.handle} />
}

const styles = StyleSheet.create({
  btn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center', paddingHorizontal: 16 },
  label: { fontWeight: '700', fontSize: 16 },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.25)',
    backgroundColor: '#fff',
  },
  pillOn: { borderColor: 'rgba(245,102,0,0.55)', backgroundColor: 'rgba(245,102,0,0.12)' },
  pillLabel: { color: PURPLE, fontWeight: '700', fontSize: 12 },
  pillLabelOn: { color: ORANGE },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(11,18,32,0.16)',
    marginBottom: 12,
  },
})
