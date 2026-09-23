import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ORANGE } from 'rides-native/places.js'

const TABS = [
  { id: 'schedule', href: '/schedule', label: 'Schedule', icon: 'calendar-outline' as const },
  { id: 'friends', href: '/friends', label: 'Friends', icon: 'people-outline' as const },
  { id: 'account', href: '/account', label: 'Account', icon: 'person-outline' as const },
  { id: 'home', href: '/', label: 'Rides', icon: 'car-outline' as const },
]

export function MainTabs({ active }: { active: 'schedule' | 'friends' | 'account' | 'home' }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {TABS.map((tab) => {
        const on = tab.id === active
        const color = on ? ORANGE : '#8B939E'
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => router.replace(tab.href)}
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

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(82,45,128,0.12)',
    paddingTop: 8,
  },
  item: { flex: 1, alignItems: 'center', gap: 2 },
  label: { fontSize: 11, fontWeight: '700' },
})
