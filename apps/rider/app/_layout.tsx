import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from '@/lib/auth'
import { BootScreen } from '@/components/BootScreen'

function Gate({ children }: { children: ReactNode }) {
  const { loading } = useAuth()
  if (loading) return <BootScreen />
  return children
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <Gate>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F7F4F0' } }} />
      </Gate>
    </AuthProvider>
  )
}
