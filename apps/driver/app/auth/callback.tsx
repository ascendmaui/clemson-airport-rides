import { useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { useEffect } from 'react'
import { completeGoogleSession } from 'rides-native/googleAuth'
import { supabase } from '@/lib/supabase'

export default function AuthCallback() {
  const router = useRouter()
  useEffect(() => {
    let alive = true
    Linking.getInitialURL().then(async (url) => {
      try {
        if (url && supabase) await completeGoogleSession(supabase, url)
      } catch (err) {
        console.warn('[auth] google callback', err instanceof Error ? err.message : err)
      }
      if (alive) router.replace('/')
    })
    return () => {
      alive = false
    }
  }, [router])
  return null
}
