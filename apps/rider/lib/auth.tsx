import { createAuth } from 'rides-native/createAuth'
import { PASSWORD_RESET_REDIRECT } from 'rides-native/riderShell.js'
import { authStorage } from '@/lib/storage'
import { supabase, supabaseConfigured } from '@/lib/supabase'

const clerkSignOutRef: { current: null | (() => Promise<void> | void) } = { current: null }
const passwordRecoveryRef: { current: null | (() => void) } = { current: null }

export function bindClerkSignOut(fn: null | (() => Promise<void> | void)) {
  clerkSignOutRef.current = fn
}

export function bindPasswordRecovery(fn: null | (() => void)) {
  passwordRecoveryRef.current = fn
}

const auth = createAuth({
  supabase,
  supabaseConfigured,
  storage: authStorage,
  passwordResetRedirectTo: PASSWORD_RESET_REDIRECT,
  onSignOut: () => clerkSignOutRef.current?.(),
  onPasswordRecovery: () => passwordRecoveryRef.current?.(),
})

export const AuthProvider = auth.AuthProvider
export const useAuth = auth.useAuth
