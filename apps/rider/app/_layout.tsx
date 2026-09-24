import { ClerkProvider, useClerk } from '@clerk/expo'
import { tokenCache } from '@clerk/expo/token-cache'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, type ReactNode } from 'react'
import { AuthProvider, bindClerkSignOut, useAuth } from '@/lib/auth'
import { clerkPublishableKey } from '@/lib/clerkEnv'
import { PasswordRecoveryListener } from '@/lib/passwordRecovery'
import { BootScreen } from '@/components/BootScreen'
import { setCarpoolApiBase } from 'rides-native/shared/carpoolApi.js'

setCarpoolApiBase(process.env.EXPO_PUBLIC_API_BASE || 'https://clemson-airport-rides.vercel.app')

function Gate({ children }: { children: ReactNode }) {
  const { loading } = useAuth()
  if (loading) return <BootScreen />
  return children
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

function AppTree() {
  return (
    <AuthProvider>
      <PasswordRecoveryListener />
      <Gate>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F7F4F0' } }} />
      </Gate>
    </AuthProvider>
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
