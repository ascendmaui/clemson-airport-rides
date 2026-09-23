import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ORANGE, PURPLE } from 'rides-native/places.js'

export function PrimaryButton({
  label,
  onPress,
  disabled,
  tone = 'orange',
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  tone?: 'orange' | 'purple' | 'ghost'
}) {
  const background = tone === 'orange' ? ORANGE : tone === 'purple' ? PURPLE : 'rgba(255,255,255,0.7)'
  const color = tone === 'ghost' ? PURPLE : '#fff'
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[styles.btn, { backgroundColor: background, opacity: disabled ? 0.55 : 1 }]}
    >
      <Text style={[styles.label, { color }]}>{label}</Text>
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
