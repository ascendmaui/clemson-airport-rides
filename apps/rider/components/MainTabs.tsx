import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GlassTabBar } from 'rides-native/icons'
import { useTheme } from '@/lib/theme'
import { tapHaptic } from '@/lib/feedback'
import { useAuth } from '@/lib/auth'
import { setAuthNext } from '@/lib/authNext'

export const RIDER_TABS = [
  { id: 'home', href: '/', label: 'Home', icon: 'home' },
  { id: 'rides', href: '/history', label: 'Rides', icon: 'rides' },
  { id: 'money', href: '/billing', label: 'Money', icon: 'money' },
  { id: 'account', href: '/account', label: 'Account', icon: 'account' },
] as const

export type RiderTab = (typeof RIDER_TABS)[number]['id']
/** Older call sites: Schedule lives in Rides, Friends/Carpool is a Home shortcut. */
type LegacyTab = 'schedule' | 'friends'

function tabFor(active: RiderTab | LegacyTab): RiderTab {
  if (active === 'schedule') return 'rides'
  if (active === 'friends') return 'home'
  return active
}

export function MainTabs({ active }: { active: RiderTab | LegacyTab }) {
  const router = useRouter()
  const { user } = useAuth()
  const insets = useSafeAreaInsets()
  const { scheme } = useTheme()
  const current = tabFor(active)
  const index = RIDER_TABS.findIndex((tab) => tab.id === current)
  return (
    <GlassTabBar
      tabs={RIDER_TABS.map((tab) => ({ id: tab.id, label: tab.label, icon: tab.icon }))}
      activeIndex={index}
      scheme={scheme}
      bottomInset={insets.bottom}
      onSelect={(tab: { id: string }) => {
        const target = RIDER_TABS.find((item) => item.id === tab.id)
        if (!target || target.id === current) return
        void tapHaptic()
        if (target.id !== 'home' && !user) {
          setAuthNext(target.href)
          router.push('/sign-in')
          return
        }
        router.replace(target.href)
      }}
    />
  )
}
