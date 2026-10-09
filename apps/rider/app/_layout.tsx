import { Stack, useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { StatusBar } from 'expo-status-bar'
import { useEffect, type ReactNode } from 'react'
import { View } from 'react-native'
import { ApproachAlert } from '@/components/ApproachAlert'
import { LostItemBanner } from 'rides-native/LostItemBanner.jsx'
import { RiderMatchPopup } from '@/components/RiderMatchPopup'
import { AuthProvider, useAuth } from '@/lib/auth'
import { PasswordRecoveryListener } from '@/lib/passwordRecovery'
import { ThemeProvider, useTheme } from '@/lib/theme'
import { useApproachingTrip } from '@/lib/useRiderTrip'
import { useRiderPickupStream } from '@/lib/useRiderPickupStream'
import { BootScreen } from '@/components/BootScreen'
import { clearAmbassadorCode, loadAmbassadorCode, saveAmbassadorCode } from '@/lib/ambassadorCode'
import { supabase } from '@/lib/supabase'
import { ambassadorCodeFromLocation } from 'rides-native/shared/ambassadorAttribution.js'
import { claimAmbassadorAttribution } from 'rides-native/shared/carpoolApi.js'
import { isTigerPassReturn, parseCheckoutReturn, parseCheckoutSessionId } from 'rides-native/checkoutReturn.js'
import { reconcileCheckout } from 'rides-native/riderMoney.js'
import { ProfileRequiredGate } from 'rides-native/PartyScreens'
import { resolveApiBase } from 'rides-native/apiOrigin.js'
import { setCarpoolApiBase } from 'rides-native/shared/carpoolApi.js'
import * as Notifications from 'expo-notifications'
import { registerRiderPush, tripIdFromPush } from '@/lib/push'

setCarpoolApiBase(resolveApiBase())

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
        role="rider"
        onOpen={(tripId: string) => router.push({ pathname: '/requested', params: { trip: tripId } })}
      />
    </View>
  )
}

function ApproachHost() {
  const { user } = useAuth()
  const trip = useApproachingTrip(user?.id || null)
  useRiderPickupStream(user?.id || null)
  return <ApproachAlert status={trip?.status ?? null} driverId={trip?.driver_id ?? null} tripId={trip?.id ?? null} />
}

function Gate({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth()
  const { colors } = useTheme()
  if (loading) return <BootScreen />
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ProfileRequiredGate user={user} supabase={supabase} />
      <LostItemHost />
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
    const sub = Linking.addEventListener('url', (event: { url: string }) => open(event.url))
    return () => sub.remove()
  }, [router])
  return null
}

const handledPushes = new Set<string>()

/** Refreshes the rider push token and opens the trip when a ride-status push is tapped. */
function RiderPushBridge() {
  const { user } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (!user?.id) return undefined
    registerRiderPush(supabase, user.id).catch(() => {})
    const open = (response: Notifications.NotificationResponse | null) => {
      const id = response?.notification.request.identifier
      if (!response || (id && handledPushes.has(id))) return
      if (id) handledPushes.add(id)
      const tripId = tripIdFromPush(response.notification.request.content.data)
      if (tripId) router.push({ pathname: '/requested', params: { trip: tripId } })
    }
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {})
    const sub = Notifications.addNotificationResponseReceivedListener(open)
    return () => sub.remove()
  }, [router, user?.id])
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

function CheckoutDeepLink() {
  const router = useRouter()
  useEffect(() => {
    const handled = new Set<string>()
    function handleUrl(url: string | null) {
      if (!url) return
      if (/[?&]setup=1(?:&|$)/.test(url)) return
      if (isTigerPassReturn(url)) {
        const sessionId = parseCheckoutSessionId(url)
        if (!sessionId || handled.has(sessionId)) return
        handled.add(sessionId)
        router.push({ pathname: '/tiger-pass', params: { session_id: sessionId } })
        return
      }
      const ret = parseCheckoutReturn(url)
      if (!ret.sessionId || handled.has(ret.sessionId)) return
      handled.add(ret.sessionId)
      if (supabase) {
        reconcileCheckout(supabase, ret.sessionId).catch((err) => {
          console.warn('[checkout-reconcile] deep link reconcile error:', err)
        })
      }
      if (ret.tripId && ret.paid) {
        if (ret.scheduled) {
          router.push({ pathname: '/schedule', params: { trip: ret.tripId, paid: '1' } })
        } else {
          router.push({ pathname: '/requested', params: { trip: ret.tripId, paid: '1' } })
        }
      }
    }
    Linking.getInitialURL().then(handleUrl).catch(() => {})
    const sub = Linking.addEventListener('url', (event: { url: string }) => handleUrl(event.url))
    return () => sub.remove()
  }, [router])
  return null
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PasswordRecoveryListener />
        <AmbassadorDeepLink />
        <AmbassadorClaim />
        <RiderPushBridge />
        <CheckoutDeepLink />
        <Gate>
          <ThemedStack />
          <ApproachHost />
          <RiderMatchPopup />
        </Gate>
      </AuthProvider>
    </ThemeProvider>
  )
}
