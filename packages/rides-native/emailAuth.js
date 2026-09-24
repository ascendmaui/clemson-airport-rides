import { mapAuthError } from './authErrors.js'

const NOT_CONFIGURED = 'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_ANON_KEY for this EAS build.'

export async function signInWithEmail(supabase, email, password) {
  if (!supabase) throw new Error(NOT_CONFIGURED)
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email || '').trim(),
    password,
  })
  if (error) throw mapAuthError(error)
  return data
}

export async function requestPasswordReset(supabase, email, redirectTo) {
  if (!supabase) throw new Error(NOT_CONFIGURED)
  const trimmed = String(email || '').trim()
  if (!trimmed) throw new Error('Enter the email on your account.')
  const options = redirectTo ? { redirectTo } : undefined
  const { data, error } = await supabase.auth.resetPasswordForEmail(trimmed, options)
  if (error) throw mapAuthError(error)
  return data
}

export async function updatePassword(supabase, password) {
  if (!supabase) throw new Error(NOT_CONFIGURED)
  const next = String(password || '')
  if (next.length < 6) throw new Error('Use at least 6 characters.')
  const { data, error } = await supabase.auth.updateUser({ password: next })
  if (error) throw mapAuthError(error)
  return data
}
