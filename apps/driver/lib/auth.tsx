import { createAuth } from 'rides-native/createAuth'
import { authStorage } from '@/lib/storage'
import { supabase, supabaseConfigured } from '@/lib/supabase'

const clerkSignOutRef: { current: null | (() => Promise<void> | void) } = { current: null }

/** Set by ClerkSignOutSync so app sign-out also ends the Clerk social session. */
export function bindClerkSignOut(fn: null | (() => Promise<void> | void)) {
  clerkSignOutRef.current = fn
}

const auth = createAuth({
  supabase,
  supabaseConfigured,
  storage: authStorage,
  passwordResetRedirectTo: 'clemsonrides-driver://set-password',
  onSignOut: () => clerkSignOutRef.current?.(),
})

export const AuthProvider = auth.AuthProvider
export const useAuth = auth.useAuth
