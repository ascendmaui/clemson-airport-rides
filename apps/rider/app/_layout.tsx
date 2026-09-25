import { Stack, useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { StatusBar } from 'expo-status-bar'
import { useEffect, type ReactNode } from 'react'
import { View } from 'react-native'
import { ApproachAlert } from '@/components/ApproachAlert'
import { AuthProvider, useAuth } from '@/lib/auth'
import { PasswordRecoveryListener } from '@/lib/passwordRecovery'
import { ThemeProvider, useTheme } from '@/lib/theme'
import { useApproachingTrip } from '@/lib/useRiderTrip'
import { BootScreen } from '@/components/BootScreen'
import { clearAmbassadorCode, loadAmbassadorCode, saveAmbassadorCode } from '@/lib/ambassadorCode'
import { supabase } from '@/lib/supabase'
import { ambassadorCodeFromLocation } from 'rides-native/shared/ambassadorAttribution.js'
import { claimAmbassadorAttribution } from 'rides-native/shared/carpoolApi.js'
import { ProfileRequiredGate } from 'rides-native/PartyScreens'
import { resolveApiBase } from 'rides-native/apiOrigin.js'
import { setCarpoolApiBase } from 'rides-native/shared/carpoolApi.js'

setCarpoolApiBase(resolveApiBase())

function ApproachHost() {
  const { user } = useAuth()
  const trip = useApproachingTrip(user?.id || null)
  return <ApproachAlert status={trip?.status ?? null} driverId={trip?.driver_id ?? null} />
}

function Gate({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth()
  const { colors } = useTheme()
  if (loading) return <BootScreen />
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ProfileRequiredGate user={user} supabase={supabase} />
      {children}
    </View>
  )
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

function AmbassadorDeepLink() {
  const router = useRouter()
  useEffect(() => {
    function open(url: string | null) {
      const code = ambassadorCodeFromLocation({ href: url || '' })
      if (code) router.push(`/a/${code}`)
    }
    Linking.getInitialURL().then(open).catch(() => {})
    const sub = Linking.addEventListener('url', (event) => open(event.url))
    return () => sub.remove()
  }, [router])
  return null
}

function AmbassadorClaim() {
  const { user } = useAuth()
  useEffect(() => {
    if (!user?.id) return undefined
    let alive = true
    loadAmbassadorCode(user.id)
      .then(async (code) => {
        if (!alive || !code) return
        try {
          const data = await claimAmbassadorAttribution(supabase, code)
          if (alive && data?.code) await saveAmbassadorCode(data.code, user.id)
        } catch (err) {
          const claim = err as { status?: number; payload?: { code?: string } }
          if (claim.status === 404 || claim.status === 409 || claim.payload?.code === 'own_link') {
            await clearAmbassadorCode()
          }
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [user?.id])
  return null
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PasswordRecoveryListener />
        <AmbassadorDeepLink />
        <AmbassadorClaim />
        <Gate>
          <ThemedStack />
          <ApproachHost />
        </Gate>
      </AuthProvider>
    </ThemeProvider>
  )
}
