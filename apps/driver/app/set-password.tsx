import { useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { useEffect, useState } from 'react'
import { SetNewPasswordScreen } from 'rides-native/AuthScreens'
import { parseSupabaseAuthUrl } from 'rides-native/authUrl'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export default function SetPasswordRoute() {
  const router = useRouter()
  const { updatePassword, user } = useAuth()
  const [ready, setReady] = useState(false)
  const [note, setNote] = useState<string | null>('Opening your reset link…')

  useEffect(() => {
    let alive = true
    async function consume(url: string | null) {
      try {
        const parsed = url ? parseSupabaseAuthUrl(url) : null
        if (parsed && supabase) {
          if (parsed.kind === 'code') {
            const { error } = await supabase.auth.exchangeCodeForSession(parsed.code)
            if (error) throw error
          } else {
            const { error } = await supabase.auth.setSession({
              access_token: parsed.accessToken,
              refresh_token: parsed.refreshToken,
            })
            if (error) throw error
          }
          if (!alive) return
          setReady(true)
          setNote('Reset link accepted. Choose a new password.')
          return
        }
        if (!alive) return
        if (user) {
          setReady(true)
          setNote('Signed in. Choose a new password for this account.')
          return
        }
        setNote('Open the reset link from your email on this phone. It uses clemsonrides-driver://set-password.')
      } catch (err) {
        if (!alive) return
        setNote(err instanceof Error ? err.message : 'Could not open that reset link.')
      }
    }
    Linking.getInitialURL().then((url) => {
      if (!alive) return
      void consume(url)
    })
    const sub = Linking.addEventListener('url', ({ url }) => {
      void consume(url)
    })
    return () => {
      alive = false
      sub.remove()
    }
  }, [user])

  return (
    <SetNewPasswordScreen
      updatePassword={updatePassword}
      ready={ready || Boolean(user)}
      statusNote={note}
      mark="CD"
      onSuccess={() => router.replace('/')}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/sign-in')
      }}
    />
  )
}
