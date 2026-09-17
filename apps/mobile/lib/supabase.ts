import { createClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'

const extra = (Constants.expoConfig?.extra || {}) as {
  supabaseUrl?: string
  supabaseAnonKey?: string
}

const url =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  extra.supabaseUrl ||
  'https://awktabuhijrshmsmagpq.supabase.co'

const key =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  extra.supabaseAnonKey ||
  ''

export const supabaseConfigured = Boolean(url && key)

export const supabase = supabaseConfigured
  ? createClient(url, key)
  : null

export function isSupabaseConfigured() {
  return supabaseConfigured
}
