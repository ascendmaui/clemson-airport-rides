import { useCallback } from 'react'
import { usePathname, useRouter, type Href } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GlassTabBar } from 'rides-native/icons'
import { useTheme } from '@/lib/theme'
import { tapHaptic } from '@/lib/feedback'
import { useAuth } from '@/lib/auth'
import { setAuthNext } from '@/lib/authNext'
import {
  RIDER_MAIN_TABS,
  applyTabNavigation,
  normalizeTabPath,
  tabIndexForPath,
  tabRequiresAuth,
  type RiderMainTabId,
} from '@/lib/tabSwipe'

export const RIDER_TABS = RIDER_MAIN_TABS

export type RiderTab = RiderMainTabId
/** Call sites from before Schedule and Friends were their own tabs. */
type LegacyTab = 'home' | 'money' | 'schedule' | 'friends'

function tabFor(active: RiderTab | LegacyTab): RiderTab {
  switch (active) {
    case 'home':
      return 'rides'
    case 'money':
      return 'account'
    case 'rides':
    case 'schedule':
    case 'friends':
    case 'account':
      return active
    default: {
      const exhaustive: never = active
      return exhaustive
    }
  }
}

/** Tap and swipe both end here, so the highlighted tab and the route stay the same. */
export function useOpenRiderTab() {
  const router = useRouter()
  const pathname = usePathname()
  const { user } = useAuth()
  return useCallback((next: number) => {
    const tab = RIDER_MAIN_TABS[next]
    if (!tab) return
    if (tabRequiresAuth(tab.id) && !user) {
      setAuthNext(tab.href as Href)
      router.push('/sign-in')
      return
    }
    if (normalizeTabPath(pathname) === tab.href) return
    void tapHaptic()
    router.replace(tab.href as Href)
  }, [pathname, router, user])
}

export function MainTabs({ active }: { active: RiderTab | LegacyTab }) {
  const open = useOpenRiderTab()
  const insets = useSafeAreaInsets()
  const { scheme } = useTheme()
  const current = tabFor(active)
  const index = RIDER_TABS.findIndex((tab) => tab.id === current)
  return (
    <GlassTabBar
      tabs={RIDER_TABS.map((tab) => ({ id: tab.id, label: tab.label, icon: tab.icon }))}
      activeIndex={index < 0 ? 0 : index}
      scheme={scheme}
      bottomInset={insets.bottom}
      onSelect={(_tab: { id: string }, selected: number) => {
        const next = applyTabNavigation(index < 0 ? tabIndexForPath('/') : index, { type: 'tap', index: selected })
        open(next)
      }}
    />
  )
}
