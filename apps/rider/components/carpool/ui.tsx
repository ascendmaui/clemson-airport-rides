import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, Platform, Pressable, Text, TextInput, View } from 'react-native'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

export function SkeletonBlock({
  height,
  width = '100%',
  radius = 12,
}: {
  height: number
  width?: number | `${number}%`
  radius?: number
}) {
  const styles = useThemedStyles(makeStyles)
  const opacity = useRef(new Animated.Value(0.45)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])
  return <Animated.View style={[styles.bone, { height, width, borderRadius: radius, opacity }]} />
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  )
}

export function Card({ children }: { children: ReactNode }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  return <View style={[styles.card, lift(colors, 'rest')]}>{children}</View>
}

export function BackButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Back" style={[styles.back, lift(colors, 'rest')]}>
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
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        style={styles.input}
      />
    </View>
  )
}

export function ErrorText({ children }: { children: string }) {
  const styles = useThemedStyles(makeStyles)
  return <Text style={styles.error}>{children}</Text>
}

export function SplitModePicker({
  value,
  onChange,
}: {
  value: 'even' | 'by_distance'
  onChange: (mode: 'even' | 'by_distance') => void
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.splitRow}>
      <SplitChoice label="Even" selected={value === 'even'} onPress={() => onChange('even')} />
      <SplitChoice label="By distance" selected={value === 'by_distance'} onPress={() => onChange('by_distance')} />
    </View>
  )
}

function SplitChoice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={styles.splitChoice}>
      <View style={[styles.radio, selected && styles.radioOn]} />
      <Text style={styles.splitLabel}>{label}</Text>
    </Pressable>
  )
}

function makeStyles(colors: Palette) {
  return {
    bone: { backgroundColor: colors.track },
    empty: {
      marginTop: 16,
      padding: 16,
      borderRadius: 16,
      backgroundColor: colors.purpleSoft,
      borderWidth: 1,
      borderColor: colors.border,
    },
    emptyTitle: { color: colors.title, fontWeight: '800' as const, fontSize: 16 },
    emptyBody: { marginTop: 6, color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    card: {
      marginTop: 16,
      padding: 16,
      borderRadius: 16,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    back: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.card,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      marginBottom: 12,
    },
    backLabel: { fontSize: 20, color: colors.title, fontWeight: '700' as const },
    field: { marginBottom: 12 },
    fieldLabel: { fontSize: 12, fontWeight: '700' as const, color: colors.ink, marginBottom: 6 },
    input: {
      backgroundColor: colors.input,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.ink,
    },
    error: { color: colors.danger, fontSize: 13, marginTop: 10, lineHeight: 18 },
    splitRow: { flexDirection: 'row' as const, gap: 18, marginBottom: 12 },
    splitChoice: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
    radio: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: colors.border,
    },
    radioOn: { borderColor: colors.orange, backgroundColor: colors.orange },
    splitLabel: { fontWeight: '700' as const, color: colors.ink, fontSize: 14 },
  }
}
