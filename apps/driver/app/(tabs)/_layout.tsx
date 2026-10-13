import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { Tabs } from 'expo-router'
import { Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GlassTabBar } from 'rides-native/icons'
import { nativeGlassAvailable } from 'rides-native/glass'
import { useTheme } from '@/lib/theme'

const DRIVER_TABS = [
  { id: 'index', label: 'Home', icon: 'home' },
  { id: 'rides', label: 'Rides', icon: 'rides' },
  { id: 'earnings', label: 'Money', icon: 'money' },
  { id: 'menu', label: 'Account', icon: 'account' },
]

type BarProps = {
  state: { index: number; routes: { name: string; key: string }[] }
  navigation: { navigate: (name: string) => void; emit: (event: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean } }
}

function DriverTabBar({ state, navigation }: BarProps) {
  const { scheme } = useTheme()
  const insets = useSafeAreaInsets()
  const activeName = state.routes[state.index]?.name
  return (
    <GlassTabBar
      tabs={DRIVER_TABS}
      activeIndex={Math.max(0, DRIVER_TABS.findIndex((tab) => tab.id === activeName))}
      scheme={scheme}
      app="driver"
      bottomInset={insets.bottom}
      onSelect={(tab: { id: string }) => {
        const route = state.routes.find((item) => item.name === tab.id)
        if (!route) return
        const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
        if (!event.defaultPrevented && tab.id !== activeName) navigation.navigate(tab.id)
      }}
    />
  )
}

function DriverJsTabs() {
  return (
    <Tabs
      tabBar={(props) => <DriverTabBar {...(props as unknown as BarProps)} />}
      screenOptions={{ headerShown: false, animation: 'fade' }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="rides" options={{ title: 'Rides' }} />
      <Tabs.Screen name="earnings" options={{ title: 'Money' }} />
      <Tabs.Screen name="menu" options={{ title: 'Account' }} />
    </Tabs>
  )
}

function DriverNativeTabs() {
  return (
    <NativeTabs minimizeBehavior="never" tintColor="#F56600">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="rides">
        <NativeTabs.Trigger.Label>Rides</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="car.fill" md="directions_car" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="earnings">
        <NativeTabs.Trigger.Label>Money</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="dollarsign.circle.fill" md="payments" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="menu">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}

export default function DriverTabs() {
  if (Platform.OS === 'ios' && nativeGlassAvailable()) return <DriverNativeTabs />
  return <DriverJsTabs />
}
