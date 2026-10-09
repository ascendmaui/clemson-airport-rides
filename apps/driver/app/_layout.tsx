import '@/lib/backgroundLocation'
import { Stack, useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { useEffect, type ReactNode } from 'react'
import { AppState, View } from 'react-native'
import { BootScreen } from '@/components/BootScreen'
import { AuthProvider, useAuth } from '@/lib/auth'
import { FeedbackProvider } from '@/lib/feedback'
import { OfferBridge } from '@/components/OfferBridge'
import { LostItemBanner } from 'rides-native/LostItemBanner.jsx'
import { registerDriverPush, setRideAlertSurface } from '@/lib/push'
import { supabase } from '@/lib/supabase'
import { ThemeProvider, useTheme } from '@/lib/theme'
import { ProfileRequiredGate } from 'rides-native/PartyScreens'
import { PasswordRecoveryListener } from '@/lib/passwordRecovery'
import { reconcileTripBackgroundLocation } from '@/lib/backgroundLocation'

function LostItemHost() {
  const { user } = useAuth()
  const { colors } = useTheme()
  const router = useRouter()
  if (!user?.id) return null
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 52, left: 0, right: 0, zIndex: 30 }}>
      <LostItemBanner
        supabase={supabase}
        userId={user.id}
        colors={colors}
        role="driver"
        onOpen={(tripId: string) => router.push({ pathname: '/trip', params: { id: tripId } })}
      />
    </View>
  )
}

function Gate({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth()
  useEffect(() => {
    if (loading) return undefined
    const reconcile = () => {
      void reconcileTripBackgroundLocation().catch(() => {})
    }
    reconcile()
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcile()
    })
    return () => listener.remove()
  }, [loading, user?.id])
  if (loading) return <BootScreen />
  return (
    <View style={{ flex: 1 }}>
      <ProfileRequiredGate user={user} supabase={supabase} />
      <LostItemHost />
      {children}
    </View>
  )
}

function PushBridge() {
  const { user } = useAuth()
  const router = useRouter()
  useEffect(() => {
    setRideAlertSurface({ active: AppState.currentState === 'active' })
    const sub = AppState.addEventListener('change', (state: string) => {
      setRideAlertSurface({ active: state === 'active' })
    })
    return () => sub.remove()
  }, [])
  useEffect(() => {
    if (!user) {
      setRideAlertSurface({ online: false })
      return undefined
    }
    registerDriverPush(supabase, user.id).catch(() => {})
    const sub = Notifications.addNotificationResponseReceivedListener((response: Notifications.NotificationResponse) => {
      const tripId = response.notification.request.content.data?.tripId
      if (typeof tripId === 'string' && tripId) {
        router.push({ pathname: '/trip', params: { id: tripId } })
        return
      }
      router.push('/queue')
    })
    return () => sub.remove()
  }, [router, user])
  return null
}

function ThemedStack() {
  const { colors } = useTheme()
  return (
    <>
      <StatusBar style={colors.statusBar} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      />
    </>
  )
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <FeedbackProvider>
          <Gate>
            <PasswordRecoveryListener />
            <PushBridge />
            <OfferBridge />
            <ThemedStack />
          </Gate>
        </FeedbackProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
