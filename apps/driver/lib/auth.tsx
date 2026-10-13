import { createAuth } from 'rides-native/createAuth'
import { authStorage } from '@/lib/storage'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { stopTripBackgroundLocation } from '@/lib/backgroundLocation'

const auth = createAuth({
  supabase,
  supabaseConfigured,
  storage: authStorage,
  passwordResetRedirectTo: 'clemsonrides-driver://set-password',
  onSignOut: stopTripBackgroundLocation,
})

export const AuthProvider = auth.AuthProvider
export const useAuth = auth.useAuth
