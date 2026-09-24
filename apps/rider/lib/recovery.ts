import * as Linking from 'expo-linking'
import { Platform } from 'react-native'
import { parseRecoveryUrl } from 'rides-native/riderShell.js'
import { supabase } from '@/lib/supabase'

function browserHref() {
  if (Platform.OS !== 'web') return null
  const href = (globalThis as { location?: { href?: string } }).location?.href
  return typeof href === 'string' ? href : null
}

export async function currentRecoveryUrl() {
  const initial = await Linking.getInitialURL()
  return initial || browserHref()
}

export async function applyRecoveryLink(url: string | null) {
  const parsed = parseRecoveryUrl(url)
  if (!parsed) return { applied: false as const, reason: 'missing' as const }
  if (!supabase) return { applied: false as const, reason: 'offline' as const }
  if (parsed.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code)
    if (error) throw error
    return { applied: true as const, reason: 'code' as const }
  }
  if (parsed.accessToken && parsed.refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: parsed.accessToken,
      refresh_token: parsed.refreshToken,
    })
    if (error) throw error
    return { applied: true as const, reason: 'session' as const }
  }
  return { applied: false as const, reason: 'incomplete' as const }
}
