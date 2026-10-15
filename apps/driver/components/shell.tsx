import { GlassButton, GlassSurface, glassTextColor } from 'rides-native/glass'
import { Glyph } from 'rides-native/icons'
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { color, glowStyle, motion, radius, type as typeScale } from 'rides-native/shared/theme.js'
import { Enter } from '@/lib/enterMotion'
import { useTheme } from '@/lib/theme'
import { useLift } from '@/components/chrome'

type IconName = string
type GoTone = 'orange' | 'purple' | 'green'

function isChevron(icon: string) {
  return icon === 'chevron-back' || icon === 'back' || icon === 'chevron-forward' || icon === 'forward'
}

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
  const chevron = isChevron(icon)
  const ink = glassTextColor({ app: 'driver', scheme, variant: 'fab' })
  return (
    <GlassButton
      app="driver"
      scheme={scheme}
      variant="fab"
      showStreak={!chevron}
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={styles.circle}
    >
      <Glyph name={icon} size={22} color={ink} strokeWidth={chevron ? 2.6 : undefined} />
    </GlassButton>
  )
}

export function GoButton({
  online,
  busy,
  tone = 'orange',
  cue = 0,
  onPress,
}: {
  online: boolean
  busy: boolean
  tone?: GoTone
  cue?: number
  onPress: () => void
}) {
  const { scheme } = useTheme()
  const accent: GoTone = online ? 'purple' : tone
  const ink = glassTextColor({ app: 'driver', scheme, variant: 'fab', accent })
  const scale = useRef(new Animated.Value(1)).current
  useEffect(() => {
    scale.setValue(1)
  }, [online, scale])
  useEffect(() => {
    if (!cue) return undefined
    scale.setValue(1)
    const anim = Animated.sequence([
      Animated.timing(scale, { toValue: 0.86, duration: 90, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }),
    ])
    anim.start(({ finished }) => {
      if (finished) scale.setValue(1)
    })
    return () => anim.stop()
  }, [cue, scale])
  const label = online ? 'Go offline' : tone === 'green' ? 'Going online' : 'Go online'

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <GlassButton
        app="driver"
        scheme={scheme}
        variant="fab"
        accent={accent}
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={online ? 'Takes you offline' : 'Goes online to receive ride requests'}
        accessibilityState={{ disabled: busy, busy }}
        style={styles.go}
      >
        <Glyph name="online" size={22} color={ink} />
        <Text style={[styles.goText, { color: ink }]}>
          {online ? 'END' : 'GO'}
        </Text>
      </GlassButton>
    </Animated.View>
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
    // Orange glow; on Android also a soft orange ring, since elevation shadows draw grey there.
    ...glowStyle(color.orange, Platform.OS),
  },
  goText: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 30,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    width: 84,
  },
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
