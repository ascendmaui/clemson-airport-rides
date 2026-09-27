/**
 * Google sign-in through Supabase Auth for rider and driver apps.
 * The Google client id and secret live in the Supabase dashboard.
 * The app only opens the provider URL and finishes the redirect.
 */
import { mapAuthError } from './authErrors.js'
import { parseSupabaseAuthUrl } from './authUrl.js'

export function googleOAuthRedirect(scheme = 'clemsonrides-driver', path = 'auth/callback') {
  const clean = String(scheme || 'clemsonrides-driver').replace(/:\/\//, '')
  return `${clean}://${String(path || 'auth/callback').replace(/^\//, '')}`
}

export async function startGoogleOAuth(supabase, redirectTo) {
  if (!supabase) throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_ANON_KEY for this EAS build.')
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error) throw mapAuthError(error)
  const providerUrl = typeof data?.url === 'string' ? data.url.trim() : data?.url
  if (!providerUrl) {
    throw new Error('Google sign-in is not configured. Enable the Google provider in Supabase Auth and allow this app redirect.')
  }
  return providerUrl
}

export async function completeGoogleSession(supabase, callbackUrl) {
  if (!supabase) throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_ANON_KEY for this EAS build.')
  const parsed = parseSupabaseAuthUrl(callbackUrl)
  if (!parsed) {
    const raw = String(callbackUrl || '')
    if (/error_description=|error=/.test(raw)) {
      const hash = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : raw.slice(raw.indexOf('?') + 1)
      const params = new URLSearchParams(hash)
      throw new Error(params.get('error_description') || params.get('error') || 'Google sign-in was rejected')
    }
    throw new Error('Google sign-in did not return a session. Check the Supabase redirect allow list.')
  }
  if (parsed.kind === 'code') {
    const { data, error } = await supabase.auth.exchangeCodeForSession(parsed.code)
    if (error) throw mapAuthError(error)
    return data
  }
  const { data, error } = await supabase.auth.setSession({
    access_token: parsed.accessToken,
    refresh_token: parsed.refreshToken,
  })
  if (error) throw mapAuthError(error)
  return data
}
