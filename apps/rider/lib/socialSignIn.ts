import * as AppleAuthentication from 'expo-apple-authentication'
import * as Crypto from 'expo-crypto'
import * as WebBrowser from 'expo-web-browser'
import { useCallback } from 'react'
import { Platform } from 'react-native'
import { mapAuthError, normalizePromoCode } from 'rides-native/authErrors.js'
import { completeGoogleSession, googleOAuthRedirect, startGoogleOAuth } from 'rides-native/googleAuth.js'
import { googleAuthConfig, mapGoogleAuthError } from 'rides-native/googleAuthConfig'
import { appleFullName, splitPersonName, type SocialProviderId } from 'rides-native/socialAuth.js'
import { supabase } from '@/lib/supabase'

export function useSocialSignIn(scheme = 'clemsonrides') {
  return useCallback(
    async (
      providerId: SocialProviderId,
      extra?: { promo?: string; fullName?: string },
    ): Promise<{ cancelled?: boolean } | void> => {
      if (!supabase) {
        throw mapGoogleAuthError(new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_ANON_KEY for this EAS build.'))
      }

      if (providerId === 'google') {
        const config = googleAuthConfig(process.env, { scheme })
        if (!config.enabled) {
          throw mapGoogleAuthError(new Error('Google sign-in is coming soon'))
        }
        try {
          const redirect = config.redirectUri || googleOAuthRedirect(scheme)
          const url = await startGoogleOAuth(supabase, redirect)
          const result = await WebBrowser.openAuthSessionAsync(url, redirect)
          if (result.type !== 'success') {
            return { cancelled: true }
          }
          if (result.url) {
            await completeGoogleSession(supabase, result.url)
          }
          return
        } catch (err: unknown) {
          const mapped = mapGoogleAuthError(err)
          if (mapped.cancelled) {
            return { cancelled: true }
          }
          throw mapped
        }
      }

      if (providerId === 'apple') {
        const isNativeAvailable =
          Platform.OS === 'ios' && (await AppleAuthentication.isAvailableAsync().catch(() => false))

        if (!isNativeAvailable) {
          const redirect = googleOAuthRedirect(scheme)
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'apple',
            options: {
              redirectTo: redirect,
              skipBrowserRedirect: true,
            },
          })
          if (error || !data?.url) {
            throw new Error('Sign in with Apple is not available on this device.')
          }
          const result = await WebBrowser.openAuthSessionAsync(data.url, redirect)
          if (result.type !== 'success') {
            return { cancelled: true }
          }
          if (result.url) {
            await completeGoogleSession(supabase, result.url)
          }
          return
        }

        const rawNonce = Crypto.randomUUID()
        const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce)

        let credential: AppleAuthentication.AppleAuthenticationCredential
        try {
          credential = await AppleAuthentication.signInAsync({
            requestedScopes: [
              AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
              AppleAuthentication.AppleAuthenticationScope.EMAIL,
            ],
            nonce: hashedNonce,
          })
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code
          const msg = String((err as Error)?.message || err)
          if (code === 'ERR_REQUEST_CANCELED' || /canceled|cancelled|ERR_REQUEST_CANCELED/i.test(msg)) {
            return { cancelled: true }
          }
          throw err
        }

        if (!credential.identityToken) {
          throw new Error('Apple sign-in did not return an identity token')
        }

        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
          nonce: rawNonce,
        })
        if (error) throw mapAuthError(error)

        const user = data.user
        if (user?.id) {
          const nameFromApple = appleFullName(credential.fullName)
          const fullName = nameFromApple || (extra?.fullName ? extra.fullName.trim() : null)
          const nameParts = splitPersonName(fullName)
          const firstName = nameParts?.firstName || ''
          const lastName = nameParts?.lastName || ''

          const userMeta = user.user_metadata || {}
          const metaUpdate: Record<string, string> = {}
          if (!userMeta.full_name && fullName) metaUpdate.full_name = fullName
          if (!userMeta.first_name && firstName) metaUpdate.first_name = firstName
          if (!userMeta.last_name && lastName) metaUpdate.last_name = lastName
          const promoCode = normalizePromoCode(extra?.promo)
          if (!userMeta.promo_code && promoCode) metaUpdate.promo_code = promoCode
          if (Object.keys(metaUpdate).length > 0) {
            try {
              await supabase.auth.updateUser({ data: metaUpdate })
            } catch (e) {
              console.warn('[auth] updateUser metadata', e)
            }
          }

          try {
            const { data: existingProfile } = await supabase
              .from('profiles')
              .select('id, full_name, email')
              .eq('id', user.id)
              .maybeSingle()

            const patch: Record<string, unknown> = {
              updated_at: new Date().toISOString(),
            }
            // ensureProfile (createAuth) may already have written the email local-part
            // or 'Rider' as a placeholder on SIGNED_IN, so treat those as empty.
            const existingName = String(existingProfile?.full_name || '').trim()
            const placeholderNames = new Set(
              ['rider', 'driver', String(user.email || '').split('@')[0].toLowerCase()].filter(Boolean),
            )
            const nameIsPlaceholder = !existingName || placeholderNames.has(existingName.toLowerCase())
            if (nameIsPlaceholder && fullName) {
              patch.full_name = fullName.slice(0, 80)
            }
            const emailToSave = credential.email || user.email
            if (!existingProfile?.email && emailToSave) {
              patch.email = emailToSave
            }
            if (Object.keys(patch).length > 1) {
              if (existingProfile) {
                await supabase.from('profiles').update(patch).eq('id', user.id)
              } else {
                await supabase.from('profiles').upsert({ id: user.id, ...patch }, { onConflict: 'id' })
              }
            }
          } catch (e) {
            console.warn('[auth] apple profile save', e)
          }
        }
        return
      }

      throw new Error(`Unsupported provider: ${providerId}`)
    },
    [scheme],
  )
}
