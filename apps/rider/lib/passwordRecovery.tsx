import { useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { useEffect } from 'react'
import { parseSupabaseAuthUrl } from 'rides-native/authUrl'
import { bindPasswordRecovery } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

async function applyAuthUrl(url: string | null) {
  if (!url || !supabase) return false
  const parsed = parseSupabaseAuthUrl(url)
  if (!parsed) return false
  if (parsed.kind === 'session') {
    const { error } = await supabase.auth.setSession({
      access_token: parsed.accessToken,
      refresh_token: parsed.refreshToken,
    })
    if (error) throw error
  } else {
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code)
    if (error) throw error
  }
  return parsed.type === 'recovery'
}

export function PasswordRecoveryListener() {
  const router = useRouter()

  useEffect(() => {
    bindPasswordRecovery(() => {
      router.replace('/set-password')
    })
    return () => bindPasswordRecovery(null)
  }, [router])

  useEffect(() => {
    let alive = true
    async function open(url: string | null) {
      try {
        const recovery = await applyAuthUrl(url)
        if (alive && recovery) router.replace('/set-password')
      } catch (err) {
        console.warn('[auth] recovery link', err instanceof Error ? err.message : err)
      }
    }
    Linking.getInitialURL().then((url) => {
      if (alive) open(url)
    })
    const sub = Linking.addEventListener('url', ({ url }) => {
      open(url)
    })
    return () => {
      alive = false
      sub.remove()
    }
  }, [router])

  return null
}
