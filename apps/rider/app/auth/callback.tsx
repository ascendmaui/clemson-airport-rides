import { useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { useEffect, useRef } from 'react'
import { completeGoogleSession } from 'rides-native/googleAuth'
import { parseSupabaseAuthUrl } from 'rides-native/authUrl'
import { supabase } from '@/lib/supabase'

// Google (and web Apple) sign-in returns here as <scheme>://auth/callback#access_token=...
// iOS hands that URL to WebBrowser.openAuthSessionAsync, so this route rarely mounts there.
// Android can also deliver it as a deep link while the app is already running, so read the
// live URL (Linking.useURL), not just the cold-start URL, and finish the session once.
export default function AuthCallback() {
  const router = useRouter()
  const url = Linking.useURL()
  const handled = useRef<string | null>(null)
  useEffect(() => {
    let alive = true
    const finish = async () => {
      const current = url || (await Linking.getInitialURL())
      if (current && current === handled.current) return
      handled.current = current
      try {
        if (current && supabase && parseSupabaseAuthUrl(current)) {
          const { data } = await supabase.auth.getSession()
          if (!data?.session) await completeGoogleSession(supabase, current)
        }
      } catch (err) {
        console.warn('[auth] google callback', err instanceof Error ? err.message : err)
      }
      if (alive) router.replace('/')
    }
    finish()
    return () => {
      alive = false
    }
  }, [router, url])
  return null
}
