import { createAuth } from 'rides-native/createAuth'
import { stopTripBackgroundLocation } from '@/lib/backgroundLocation'
import { authStorage } from '@/lib/storage'
import { STARTUP_TIMEOUT_MS } from '@/lib/startupGate'
import { supabase, supabaseConfigured } from '@/lib/supabase'

const auth = createAuth({
  supabase,
  supabaseConfigured,
  storage: authStorage,
  passwordResetRedirectTo: 'clemsonrides-driver://set-password',
  onSignOut: stopTripBackgroundLocation,
  // The sign-up promo box claims driver-side campaign codes only.
  promoSide: 'driver',
  sessionTimeoutMs: STARTUP_TIMEOUT_MS,
})

export const AuthProvider = auth.AuthProvider
export const useAuth = auth.useAuth
