import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { Card, useCardShadow } from '@/components/chrome'
import { ListRow } from '@/components/shell'
import { useTheme } from '@/lib/theme'

type IconName = keyof typeof Ionicons.glyphMap

export type MenuRow = {
  key?: string
  icon: IconName
  title: string
  subtitle?: string
  onPress: () => void
}

export function FadeIn({
  children,
  token = 0,
  style,
}: {
  children: ReactNode
  token?: string | number
  style?: StyleProp<ViewStyle>
}) {
  const opacity = useRef(new Animated.Value(0)).current
  const shift = useRef(new Animated.Value(10)).current

  useEffect(() => {
    opacity.setValue(0)
    shift.setValue(10)
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.timing(shift, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start()
  }, [opacity, shift, token])

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY: shift }] }, style]}>
      {children}
    </Animated.View>
  )
}

export function DayHeader({
  kicker,
  title,
  trailing,
}: {
  kicker?: string
  title: string
  trailing?: ReactNode
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        {kicker ? <Text style={[styles.kicker, { color: colors.orange }]}>{kicker}</Text> : null}
        <Text style={[styles.title, { color: colors.title }]}>{title}</Text>
      </View>
      {trailing}
    </View>
  )
}

export function RowGroup({ rows }: { rows: MenuRow[] }) {
  const { colors } = useTheme()
  const shadow = useCardShadow()
  if (rows.length === 0) return null
  return (
    <View style={[styles.group, shadow, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {rows.map((row, index) => (
        <ListRow
          key={row.key || row.title}
          icon={row.icon}
          title={row.title}
          subtitle={row.subtitle}
          onPress={row.onPress}
          last={index === rows.length - 1}
        />
      ))}
    </View>
  )
}

export function SoftNote({ children }: { children: string }) {
  const { colors } = useTheme()
  return (
    <View style={[styles.note, { backgroundColor: colors.track }]}>
      <Text style={{ color: colors.title, lineHeight: 20, fontSize: 14 }}>{children}</Text>
    </View>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName
  title: string
  body: string
  action?: ReactNode
}) {
  const { colors } = useTheme()
  return (
    <Card>
      <View style={[styles.badge, { backgroundColor: colors.track }]}>
        <Ionicons name={icon} size={26} color={colors.purple} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.title }]}>{title}</Text>
      <Text style={[styles.emptyBody, { color: colors.inkSecondary }]}>{body}</Text>
      {action}
    </Card>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  headerCopy: { flex: 1, gap: 2 },
  kicker: { fontWeight: '800', letterSpacing: 1.1, fontSize: 12 },
  title: { fontSize: 32, fontWeight: '800', letterSpacing: -0.6 },
  group: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  note: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 18, fontWeight: '800' },
  emptyBody: { fontSize: 14, lineHeight: 20 },
})
