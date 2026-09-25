import type { ReactNode } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/lib/theme'
import { useCardShadow } from '@/components/chrome'

type IconName = keyof typeof Ionicons.glyphMap

export function CircleButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName
  label: string
  onPress: () => void
}) {
  const { colors } = useTheme()
  const shadow = useCardShadow()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[styles.circle, shadow, { backgroundColor: colors.card }]}
    >
      <Ionicons name={icon} size={22} color={colors.title} />
    </Pressable>
  )
}

export function GoButton({
  online,
  busy,
  disabled = false,
  disabledReason,
  onPress,
}: {
  online: boolean
  busy: boolean
  disabled?: boolean
  disabledReason?: string | null
  onPress: () => void
}) {
  const { colors } = useTheme()
  const isDisabled = Boolean(busy || disabled)
  const label = disabled
    ? (disabledReason ? `Go online disabled: ${disabledReason}` : 'Go online disabled')
    : (online ? 'Go offline' : 'Go online')

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={disabled && disabledReason ? disabledReason : undefined}
      accessibilityState={{ disabled: isDisabled }}
      style={{ opacity: isDisabled ? 0.45 : 1 }}
      accessibilityLabel={online ? 'Go offline' : 'Go online'}
      accessibilityState={{ disabled: busy }}
      accessibilityHint={online ? 'Takes you offline' : 'Goes online to receive ride requests'}
      style={{ opacity: busy ? 0.7 : 1 }}
    >
      <LinearGradient
        colors={disabled ? [colors.card, colors.track] : [colors.goStart, colors.orange]}
        start={{ x: 0.72, y: 0 }}
        end={{ x: 0.28, y: 1 }}
        style={styles.go}
      >
        <Text style={[styles.goText, { color: disabled ? colors.inkSecondary : colors.onAccent }]}>
          {online ? 'END' : 'GO'}
        </Text>
      </LinearGradient>
    </Pressable>
  )
}

export function Toggle({
  on,
  onPress,
  label,
}: {
  on: boolean
  onPress: () => void
  label: string
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[styles.switch, { backgroundColor: on ? colors.fill : colors.track }]}
    >
      <View style={[styles.knob, { backgroundColor: colors.onAccent, marginLeft: on ? 22 : 0 }]} />
    </Pressable>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  const { colors } = useTheme()
  return (
    <View style={[styles.segments, { backgroundColor: colors.segment }]}>
      {options.map((option) => {
        const active = option.id === value
        return (
          <Pressable
            key={option.id}
            onPress={() => onChange(option.id)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            style={[styles.segment, active && { backgroundColor: colors.segmentOn }]}
          >
            <Text style={{ color: active ? colors.segmentTextOn : colors.segmentText, fontWeight: '800' }}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function ListRow({
  icon,
  title,
  subtitle,
  onPress,
  last = false,
}: {
  icon: IconName
  title: string
  subtitle?: string
  onPress: () => void
  last?: boolean
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: colors.border,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: colors.track }]}>
        <Ionicons name={icon} size={18} color={colors.purple} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: colors.ink }]}>{title}</Text>
        {subtitle ? <Text style={[styles.rowSub, { color: colors.inkSecondary }]}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.inkSecondary} />
    </Pressable>
  )
}

export function SectionLabel({ children }: { children: string }) {
  const { colors } = useTheme()
  return <Text style={[styles.section, { color: colors.title }]}>{children}</Text>
}

export function StackPage({
  title,
  onBack,
  children,
  footer,
  right,
}: {
  title: string
  onBack: () => void
  children: ReactNode
  footer?: ReactNode
  right?: ReactNode
}) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  return (
    <View style={[styles.page, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
      <View style={styles.pageHead}>
        <CircleButton icon="chevron-back" label="Back" onPress={onBack} />
        <Text style={[styles.pageTitle, { color: colors.title }]}>{title}</Text>
        <View style={styles.pageRight}>{right || <View style={styles.circle} />}</View>
      </View>
      <ScrollView contentContainerStyle={styles.pageBody} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
      {footer ? (
        <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
          {footer}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  circle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  go: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F56600',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  goText: { fontSize: 26, fontWeight: '800', letterSpacing: 0.5 },
  switch: { width: 52, height: 30, borderRadius: 999, padding: 3, justifyContent: 'center' },
  knob: { width: 24, height: 24, borderRadius: 12 },
  segments: { flexDirection: 'row', borderRadius: 999, padding: 4 },
  segment: { flex: 1, borderRadius: 999, alignItems: 'center', paddingVertical: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  rowIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontWeight: '800', fontSize: 16 },
  rowSub: { fontSize: 13 },
  section: { fontSize: 20, fontWeight: '800', marginTop: 18, marginBottom: 4 },
  page: { flex: 1 },
  pageHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8 },
  pageTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800' },
  pageRight: { width: 48, alignItems: 'flex-end' },
  pageBody: { padding: 16, paddingBottom: 40, gap: 12 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
})
