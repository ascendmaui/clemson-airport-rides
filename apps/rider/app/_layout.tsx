import { ClerkProvider, useClerk } from '@clerk/expo'
import { tokenCache } from '@clerk/expo/token-cache'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, type ReactNode } from 'react'
import { View } from 'react-native'
import { ApproachAlert } from '@/components/ApproachAlert'
import { AuthProvider, bindClerkSignOut, useAuth } from '@/lib/auth'
import { clerkPublishableKey } from '@/lib/clerkEnv'
import { PasswordRecoveryListener } from '@/lib/passwordRecovery'
import { ThemeProvider, useTheme } from '@/lib/theme'
import { useApproachingTrip } from '@/lib/useRiderTrip'
import { BootScreen } from '@/components/BootScreen'
import { setCarpoolApiBase } from 'rides-native/shared/carpoolApi.js'

setCarpoolApiBase(process.env.EXPO_PUBLIC_API_BASE || 'https://clemson-airport-rides.vercel.app')

function ApproachHost() {
  const { user } = useAuth()
  const trip = useApproachingTrip(user?.id || null)
  return <ApproachAlert status={trip?.status ?? null} driverId={trip?.driver_id ?? null} />
}

function Gate({ children }: { children: ReactNode }) {
  const { loading } = useAuth()
  const { colors } = useTheme()
  if (loading) return <BootScreen />
  return <View style={{ flex: 1, backgroundColor: colors.background }}>{children}</View>
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
    })
    return () => bindClerkSignOut(null)
  }, [signOut])
  return null
}

function ThemedStack() {
  const { colors } = useTheme()
  return (
    <>
      <StatusBar style={colors.statusBar} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </>
  )
}

function AppTree() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PasswordRecoveryListener />
        <Gate>
          <ThemedStack />
          <ApproachHost />
        </Gate>
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
      <AppTree />
    </ClerkProvider>
  )
}
