import { GlassButton, GlassSurface, glassTextColor } from 'rides-native/glass'
import { Glyph } from 'rides-native/icons'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { motion, radius, type as typeScale } from 'rides-native/shared/theme.js'
import { Enter } from '@/lib/enterMotion'
import { useTheme } from '@/lib/theme'
import { useLift } from '@/components/chrome'

type IconName = string

export function CircleButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName
  label: string
  onPress: () => void
}) {
  const { scheme } = useTheme()
  const ink = glassTextColor({ app: 'driver', scheme, variant: 'fab' })
  return (
    <GlassButton
      app="driver"
      scheme={scheme}
      variant="fab"
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={styles.circle}
    >
      <Glyph name={icon} size={22} color={ink} />
    </GlassButton>
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
  const { colors, scheme } = useTheme()
  const isDisabled = Boolean(busy || disabled)
  const label = disabled
    ? (disabledReason ? `Go online disabled: ${disabledReason}` : 'Go online disabled')
    : (online ? 'Go offline' : 'Go online')
  const accent = online ? 'purple' : 'orange'
  const ink = glassTextColor({ app: 'driver', scheme, variant: 'fab', accent })
  const mark = isDisabled ? colors.inkSecondary : ink

  return (
    <GlassButton
      app="driver"
      scheme={scheme}
      variant="fab"
      accent={accent}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={disabled && disabledReason ? disabledReason : online ? 'Takes you offline' : 'Goes online to receive ride requests'}
      accessibilityState={{ disabled: isDisabled, busy }}
      style={styles.go}
    >
      <Glyph name="online" size={22} color={mark} />
      <Text style={[styles.goText, { color: mark }]}>
        {online ? 'END' : 'GO'}
      </Text>
    </GlassButton>
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
  const { scheme } = useTheme()
  const ink = glassTextColor({ app: 'driver', scheme, variant: 'chip' })
  return (
    <GlassSurface app="driver" scheme={scheme} variant="chip" style={styles.segments}>
      {options.map((option) => {
        const active = option.id === value
        return (
          <GlassButton
            key={option.id}
            app="driver"
            scheme={scheme}
            variant="chip"
            accent={active ? 'orange' : 'purple'}
            selected={active}
            onPress={() => onChange(option.id)}
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            style={styles.segment}
          >
            <Text style={{ color: ink, fontWeight: '800', letterSpacing: typeScale.meta.letterSpacing }}>
              {option.label}
            </Text>
          </GlassButton>
        )
      })}
    </GlassSurface>
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
          opacity: pressed ? motion.pressOpacity : 1,
        },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: colors.track }]}>
        <Glyph name={icon} size={18} color={colors.purple} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: colors.ink }]}>{title}</Text>
        {subtitle ? <Text style={[styles.rowSub, { color: colors.inkSecondary }]}>{subtitle}</Text> : null}
      </View>
      <Glyph name="chevron-forward" size={18} color={colors.inkSecondary} />
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
  const { colors, scheme } = useTheme()
  const barShadow = useLift('bar')
  return (
    <View style={[styles.page, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
      <View style={styles.pageHead}>
        <CircleButton icon="chevron-back" label="Back" onPress={onBack} />
        <Text style={[styles.pageTitle, { color: colors.title }]}>{title}</Text>
        <View style={styles.pageRight}>{right || <View style={styles.circle} />}</View>
      </View>
      <ScrollView contentContainerStyle={styles.pageGrow} showsVerticalScrollIndicator={false}>
        <Enter style={styles.pageBody}>{children}</Enter>
      </ScrollView>
      {footer ? (
        <GlassSurface app="driver" scheme={scheme} variant="header" style={[styles.footer, barShadow, { paddingBottom: insets.bottom + 12 }]}>
          {footer}
        </GlassSurface>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  circle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    padding: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  go: {
    width: 84,
    height: 84,
    borderRadius: 42,
    padding: 0,
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
  segments: { flexDirection: 'row', borderRadius: radius.pill, padding: 4 },
  segment: { flex: 1, borderRadius: radius.pill, alignItems: 'center', paddingVertical: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  rowIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontWeight: '800', fontSize: 16, letterSpacing: typeScale.button.letterSpacing },
  rowSub: { fontSize: typeScale.meta.fontSize, letterSpacing: typeScale.meta.letterSpacing },
  section: { ...typeScale.section, marginTop: 18, marginBottom: 4 },
  page: { flex: 1 },
  pageHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8 },
  pageTitle: { flex: 1, textAlign: 'center', fontSize: typeScale.headline.fontSize, fontWeight: typeScale.headline.fontWeight, letterSpacing: typeScale.headline.letterSpacing },
  pageRight: { width: 48, alignItems: 'flex-end' },
  pageGrow: { flexGrow: 1 },
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
