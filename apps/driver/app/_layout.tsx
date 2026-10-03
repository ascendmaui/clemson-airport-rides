import { Stack, useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, type ReactNode } from 'react'
import { View } from 'react-native'
import { BootScreen } from '@/components/BootScreen'
import { AuthProvider, useAuth } from '@/lib/auth'
import { FeedbackProvider } from '@/lib/feedback'
import { DriverShiftProvider } from '@/lib/driverShiftSession'
import { OnlineTopBar } from '@/components/OnlineTopBar'
import { registerDriverPush } from '@/lib/push'
import { supabase } from '@/lib/supabase'
import { ThemeProvider, useTheme } from '@/lib/theme'
import { ProfileRequiredGate } from 'rides-native/PartyScreens'
import { PasswordRecoveryListener } from '@/lib/passwordRecovery'

function Gate({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth()
  if (loading) return <BootScreen />
  return (
    <>
      <ProfileRequiredGate user={user} supabase={supabase} />
      {children}
    </>
  )
}

function PushBridge() {
  const { user } = useAuth()
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  useEffect(() => {
    if (!user) return undefined
    registerDriverPush(supabase, user.id).catch(() => {})
    const sub = Notifications.addNotificationResponseReceivedListener((response: Notifications.NotificationResponse) => {
      const tripId = response.notification.request.content.data?.tripId
      if (typeof tripId === 'string' && tripId) {
        routerRef.current.push({ pathname: '/trip', params: { id: tripId } })
        return
      }
      routerRef.current.push('/queue')
    })
    return () => sub.remove()
  }, [user])
  return null
}

function ThemedStack() {
  const { colors } = useTheme()
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={colors.statusBar} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      />
      <OnlineTopBar />
    </View>
  )
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <FeedbackProvider>
          <DriverShiftProvider>
            <Gate>
              <PasswordRecoveryListener />
              <PushBridge />
              <ThemedStack />
            </Gate>
          </DriverShiftProvider>
        </FeedbackProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
