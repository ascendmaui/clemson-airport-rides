import { Glyph } from 'rides-native/icons'
import type { ReactNode } from 'react'
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { radius, type as typeScale } from 'rides-native/shared/theme.js'
import { Card, useCardShadow } from '@/components/chrome'
import { Enter } from '@/lib/enterMotion'
import { ListRow } from '@/components/shell'
import { useTheme } from '@/lib/theme'

type IconName = string

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
  return <Enter token={token} style={style}>{children}</Enter>
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
        <Glyph name={icon} size={26} color={colors.purple} />
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
  kicker: { ...typeScale.kicker },
  title: { ...typeScale.display },
  group: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  note: { borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 12 },
  badge: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { ...typeScale.cardTitle },
  emptyBody: { ...typeScale.body },
})
