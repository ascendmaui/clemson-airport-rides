import { createClient } from '@supabase/supabase-js'
import { secureStoreAdapter } from 'rides-native/secureStore'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://awktabuhijrshmsmagpq.supabase.co'
const key = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim()

export const supabaseConfigured = Boolean(url && key)

// Email/password and the Clerk bridge both persist a Supabase Auth session.
// Do not set `accessToken` from a Clerk JWT: Clerk user ids are not UUIDs,
// so auth.uid() would be null and existing RLS policies would stop matching.
export const supabase = supabaseConfigured
  ? createClient(url, key, {
      auth: {
        storage: secureStoreAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null

export function isSupabaseConfigured() {
  return supabaseConfigured
}
