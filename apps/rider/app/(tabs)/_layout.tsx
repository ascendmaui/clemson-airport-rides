import { Slot, usePathname, useRouter, type Href } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { MainTabPager } from '@/components/MainTabPager'
import { MainTabs, useOpenRiderTab } from '@/components/MainTabs'
import { useAuth } from '@/lib/auth'
import { setAuthNext } from '@/lib/authNext'
import { RIDER_MAIN_TABS, normalizeTabPath, tabRequiresAuth } from '@/lib/tabSwipe'
import { useReduceMotion } from '@/lib/useReduceMotion'
import { useTheme } from '@/lib/theme'
import { AccountScreen } from './account'
import { CarpoolHubScreen } from './friends'
import { RiderHome } from './index'
import { ScheduleScreen } from './schedule'

export default function RiderTabLayout() {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const { colors } = useTheme()
  const reduceMotion = useReduceMotion()
  const open = useOpenRiderTab()
  const matched = RIDER_MAIN_TABS.findIndex((tab) => tab.href === normalizeTabPath(pathname))
  // History, billing, and other stack screens stay on the tab the rider left.
  const remembered = useRef(matched >= 0 ? matched : 0)
  if (matched >= 0) remembered.current = matched
  const pathIndex = matched >= 0 ? matched : remembered.current
  const [preview, setPreview] = useState<number | null>(null)
  const activeIndex = preview ?? pathIndex
  const active = RIDER_MAIN_TABS[activeIndex] ?? RIDER_MAIN_TABS[0]
  const guardPath = useRef<string | null>(null)

  useEffect(() => {
    if (preview != null && preview === pathIndex) setPreview(null)
  }, [pathIndex, preview])

  useEffect(() => {
    const tab = matched >= 0 ? RIDER_MAIN_TABS[matched] : null
    if (matched < 0 || !tab || user || !tabRequiresAuth(tab.id)) {
      guardPath.current = null
      return
    }
    if (guardPath.current === pathname) return
    guardPath.current = pathname
    setAuthNext(tab.href as Href)
    router.replace('/sign-in')
  }, [matched, pathname, router, user])

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ height: 0, overflow: 'hidden' }} pointerEvents="none">
        <Slot />
      </View>
      <MainTabPager
        index={pathIndex}
        reduceMotion={reduceMotion}
        signedIn={Boolean(user)}
        onCommit={(next) => {
          setPreview(next === pathIndex ? null : next)
          open(next)
        }}
        onPreview={setPreview}
        onBlocked={(next) => {
          setPreview(null)
          open(next)
        }}
      >
        <RiderHome />
        {user ? <ScheduleScreen /> : <View style={{ flex: 1, backgroundColor: colors.background }} />}
        <CarpoolHubScreen />
        {user ? <AccountScreen /> : <View style={{ flex: 1, backgroundColor: colors.background }} />}
      </MainTabPager>
      <MainTabs active={active.id} />
    </View>
  )
}
