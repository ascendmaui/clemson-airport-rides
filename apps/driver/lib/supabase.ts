import { createClient } from '@supabase/supabase-js'
import { secureStoreAdapter } from 'rides-native/secureStore'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://awktabuhijrshmsmagpq.supabase.co'
const key = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim()

export const supabaseConfigured = Boolean(url && key)

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
