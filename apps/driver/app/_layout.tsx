import { ClerkProvider, useClerk } from '@clerk/expo'
import { tokenCache } from '@clerk/expo/token-cache'
import { Stack, useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { useEffect, type ReactNode } from 'react'
import { BootScreen } from '@/components/BootScreen'
import { StaleSessionGuard } from '@/components/StaleSessionGuard'
import { AuthProvider, bindClerkSignOut, useAuth } from '@/lib/auth'
import { clerkPublishableKey } from '@/lib/clerkEnv'
import { clearClerkTokenCache } from '@/lib/freshAuth'
import { FeedbackProvider } from '@/lib/feedback'
import { registerDriverPush } from '@/lib/push'
import { supabase } from '@/lib/supabase'
import { ThemeProvider, useTheme } from '@/lib/theme'
import { ProfileRequiredGate } from 'rides-native/PartyScreens'
import { PasswordRecoveryListener } from '@/lib/passwordRecovery'

function Gate({ children, clerk }: { children: ReactNode; clerk: boolean }) {
  const { loading, user } = useAuth()
  if (loading) return <BootScreen />
  return (
    <>
      {clerk ? <StaleSessionGuard /> : null}
      <ProfileRequiredGate user={user} supabase={supabase} />
      {children}
    </>
  )
}

function PushBridge() {
  const { user } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (!user) return undefined
    registerDriverPush(supabase, user.id).catch(() => {})
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
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

function ClerkSignOutSync() {
  const { signOut } = useClerk()
  useEffect(() => {
    bindClerkSignOut(async () => {
      try {
        await signOut()
      } catch {
        // Email-only sessions have no Clerk session to clear.
      }
      await clearClerkTokenCache()
    })
    return () => bindClerkSignOut(null)
  }, [signOut])
  return null
}

function AppTree({ clerk = false }: { clerk?: boolean }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <FeedbackProvider>
          <Gate clerk={clerk}>
            <PasswordRecoveryListener />
            <PushBridge />
            <ThemedStack />
          </Gate>
        </FeedbackProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default function RootLayout() {
  const publishableKey = clerkPublishableKey()
  if (!publishableKey) return <AppTree />
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ClerkSignOutSync />
      <AppTree clerk />
    </ClerkProvider>
  )
}
