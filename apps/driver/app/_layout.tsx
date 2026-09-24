import { Stack, useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { useEffect, type ReactNode } from 'react'
import { BootScreen } from '@/components/BootScreen'
import { AuthProvider, useAuth } from '@/lib/auth'
import { FeedbackProvider } from '@/lib/feedback'
import { registerDriverPush } from '@/lib/push'
import { supabase } from '@/lib/supabase'

function Gate({ children }: { children: ReactNode }) {
  const { loading } = useAuth()
  if (loading) return <BootScreen />
  return children
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

export default function RootLayout() {
  return (
    <AuthProvider>
      <FeedbackProvider>
        <Gate>
          <PushBridge />
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F7F4F0' } }} />
        </Gate>
      </FeedbackProvider>
    </AuthProvider>
  )
}
