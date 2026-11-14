import { StyleSheet, Text, View } from 'react-native'
import { CircleButton } from '@/components/shell'
import { useTheme } from '@/lib/theme'

export function NotificationInboxButton({
  count,
  onPress,
}: {
  count: number
  onPress: () => void
}) {
  const { colors } = useTheme()
  const label = count > 0 ? `Notifications, ${count} unread` : 'Notifications'
  return (
    <View style={styles.wrap}>
      <CircleButton icon="mail" label={label} onPress={onPress} />
      {count > 0 ? (
        <View
          pointerEvents="none"
          style={[styles.badge, { backgroundColor: colors.orange, borderColor: colors.onAccent }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={[styles.badgeText, { color: colors.onAccent }]}>{count > 9 ? '9+' : String(count)}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  badgeText: { fontSize: 10, fontWeight: '800' },
})
