import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { tapHaptic } from '@/lib/feedback'

const TABS = [
  { id: 'home', href: '/', label: 'Rides', icon: 'car-outline' as const },
  { id: 'schedule', href: '/schedule', label: 'Schedule', icon: 'calendar-outline' as const },
  { id: 'friends', href: '/friends', label: 'Friends', icon: 'people-outline' as const },
  { id: 'account', href: '/account', label: 'Account', icon: 'person-outline' as const },
]

export function MainTabs({ active }: { active: 'schedule' | 'friends' | 'account' | 'home' }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={[styles.bar, lift(colors, 'bar'), { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {TABS.map((tab) => {
        const on = tab.id === active
        const color = on ? colors.orange : colors.tabInactive
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (on) return
              void tapHaptic()
              router.replace(tab.href)
            }}
            style={styles.item}
          >
            <Ionicons name={tab.icon} size={22} color={color} />
            <Text style={[styles.label, { color }]}>{tab.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    bar: {
      flexDirection: 'row' as const,
      backgroundColor: colors.tabBar,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 8,
    },
    item: { flex: 1, alignItems: 'center' as const, gap: 2 },
    label: { fontSize: 11, fontWeight: '700' as const },
  }
}
