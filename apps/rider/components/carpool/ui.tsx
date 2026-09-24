import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { INK, INK_SECONDARY, PURPLE } from 'rides-native/places.js'

export function SkeletonBlock({
  height,
  width = '100%',
  radius = 12,
}: {
  height: number
  width?: number | `${number}%`
  radius?: number
}) {
  const opacity = useRef(new Animated.Value(0.45)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])
  return <Animated.View style={[styles.bone, { height, width, borderRadius: radius, opacity }]} />
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  )
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>
}

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
      <Text style={styles.backLabel}>←</Text>
    </Pressable>
  )
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize = 'sentences',
  keyboardType = 'default',
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  keyboardType?: 'default' | 'number-pad'
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8B939E"
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        style={styles.input}
      />
    </View>
  )
}

export function ErrorText({ children }: { children: string }) {
  return <Text style={styles.error}>{children}</Text>
}

export function SplitModePicker({
  value,
  onChange,
}: {
  value: 'even' | 'by_distance'
  onChange: (mode: 'even' | 'by_distance') => void
}) {
  return (
    <View style={styles.splitRow}>
      <SplitChoice label="Even" selected={value === 'even'} onPress={() => onChange('even')} />
      <SplitChoice label="By distance" selected={value === 'by_distance'} onPress={() => onChange('by_distance')} />
    </View>
  )
}

function SplitChoice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={styles.splitChoice}>
      <View style={[styles.radio, selected && styles.radioOn]} />
      <Text style={styles.splitLabel}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bone: { backgroundColor: 'rgba(82,45,128,0.14)' },
  empty: {
    marginTop: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(82,45,128,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.12)',
  },
  emptyTitle: { color: PURPLE, fontWeight: '800', fontSize: 16 },
  emptyBody: { marginTop: 6, color: INK_SECONDARY, fontSize: 14, lineHeight: 20 },
  card: {
    marginTop: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.12)',
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  backLabel: { fontSize: 20, color: INK, fontWeight: '700' },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: INK, marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.18)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: INK,
  },
  error: { color: '#B42318', fontSize: 13, marginTop: 10, lineHeight: 18 },
  splitRow: { flexDirection: 'row', gap: 18, marginBottom: 12 },
  splitChoice: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(82,45,128,0.35)',
  },
  radioOn: { borderColor: '#F56600', backgroundColor: '#F56600' },
  splitLabel: { fontWeight: '700', color: INK, fontSize: 14 },
})
