import * as WebBrowser from 'expo-web-browser'
import { completeGoogleSession, googleOAuthRedirect, startGoogleOAuth } from 'rides-native/googleAuth'
import { supabase } from '@/lib/supabase'

WebBrowser.maybeCompleteAuthSession()

export const DRIVER_GOOGLE_REDIRECT = googleOAuthRedirect('clemsonrides-driver', 'auth/callback')

export async function signInWithGoogle() {
  const url = await startGoogleOAuth(supabase, DRIVER_GOOGLE_REDIRECT)
  const result = await WebBrowser.openAuthSessionAsync(url, DRIVER_GOOGLE_REDIRECT)
  if (result.type !== 'success' || !('url' in result) || !result.url) return { cancelled: true as const }
  await completeGoogleSession(supabase, result.url)
  return { cancelled: false as const }
}
