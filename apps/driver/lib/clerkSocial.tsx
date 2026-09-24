import { getClerkInstance, useClerk, useSSO } from '@clerk/expo'
import { useSignInWithApple } from '@clerk/expo/apple'
import { useSignInWithGoogle } from '@clerk/expo/google'
import * as AuthSession from 'expo-auth-session'
import { useCallback } from 'react'
import { Platform } from 'react-native'
import {
  clerkErrorMessage,
  clerkSessionOutcome,
  isNativeProviderUnavailable,
  socialStrategy,
  splitPersonName,
} from 'rides-native/socialAuth'
import { exchangeClerkSession } from '@/lib/clerkBridge'
import { clerkPublishableKey } from '@/lib/clerkEnv'
import { checkAccountLoads, withFreshAuth, type ClerkLike } from '@/lib/freshAuth'
import { supabase } from '@/lib/supabase'

type SocialId = 'apple' | 'google' | 'facebook'

type SocialExtra = {
  promo?: string
  fullName?: string
}

type FlowResult = {
  createdSessionId: string | null
  authSessionResult?: { type: string } | null
  setActive?: (params: {
    session: string
    navigate?: (params: { session: { currentTask?: unknown; getToken: () => Promise<string | null> } }) => Promise<void>
  }) => Promise<void>
  signIn?: { status?: string | null; createdSessionId?: string | null } | null
  signUp?: {
    status?: string | null
    createdSessionId?: string | null
    missingFields?: string[]
    update?: (fields: { firstName?: string; lastName?: string }) => Promise<unknown>
  }
}

const redirectUrl = AuthSession.makeRedirectUri({
  scheme: 'clemsonrides-driver',
  path: 'sso-callback',
})

async function finishMissingName(result: FlowResult, fullName?: string) {
  const outcome = clerkSessionOutcome(result)
  if (outcome.kind !== 'missing_requirements') return result
  const name = splitPersonName(fullName)
  if (!name || !result.signUp?.update) return result
  await result.signUp.update(name)
  return {
    ...result,
    createdSessionId: result.signUp.createdSessionId || result.createdSessionId,
  }
}

function asSocialError(err: unknown) {
  if (err instanceof Error && !('errors' in err)) return err
  return new Error(clerkErrorMessage(err))
}

export function useClerkSocialSignIn() {
  const { startSSOFlow } = useSSO()
  const { startAppleAuthenticationFlow } = useSignInWithApple()
  const { startGoogleAuthenticationFlow } = useSignInWithGoogle()
  const clerk = useClerk() as unknown as ClerkLike

  return useCallback(async (providerId: SocialId, extra?: SocialExtra) => {
    try {
      // Google, Apple, and Facebook all go through the same stale-session guard:
      // a cached Clerk session that can't load an account is signed out and the
      // real OAuth flow retried once instead of surfacing `session_exists`.
      return await withFreshAuth(
        clerk,
        () => runSocialSignIn({
          providerId,
          extra,
          startSSOFlow,
          startAppleAuthenticationFlow,
          startGoogleAuthenticationFlow,
        }),
        { onSignedIn: () => ({ cancelled: false }) },
      )
    } catch (err) {
      throw asSocialError(err)
    }
  }, [clerk, startAppleAuthenticationFlow, startGoogleAuthenticationFlow, startSSOFlow])
}

async function runSocialSignIn({
  providerId,
  extra,
  startSSOFlow,
  startAppleAuthenticationFlow,
  startGoogleAuthenticationFlow,
}: {
  providerId: SocialId
  extra?: SocialExtra
  startSSOFlow: (params: { strategy: 'oauth_apple' | 'oauth_google' | 'oauth_facebook'; redirectUrl: string }) => Promise<unknown>
  startAppleAuthenticationFlow: () => Promise<unknown>
  startGoogleAuthenticationFlow: () => Promise<unknown>
}) {
    if (!supabase) {
      throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_ANON_KEY for this EAS build.')
    }
    const client = supabase

    const strategy = socialStrategy(providerId) as 'oauth_apple' | 'oauth_google' | 'oauth_facebook'
    let result: FlowResult
    switch (providerId) {
      case 'apple':
        if (Platform.OS === 'ios') {
          try {
            result = await startAppleAuthenticationFlow() as FlowResult
            break
          } catch (err) {
            if (!isNativeProviderUnavailable(err)) throw err
          }
        }
        result = await startSSOFlow({ strategy, redirectUrl }) as FlowResult
        break
      case 'google':
        if (Platform.OS === 'ios' || Platform.OS === 'android') {
          try {
            result = await startGoogleAuthenticationFlow() as FlowResult
            break
          } catch (err) {
            if (!isNativeProviderUnavailable(err)) throw err
          }
        }
        result = await startSSOFlow({ strategy, redirectUrl }) as FlowResult
        break
      case 'facebook':
        result = await startSSOFlow({ strategy, redirectUrl }) as FlowResult
        break
      default: {
        const neverProvider: never = providerId
        throw new Error(`Unknown social provider ${String(neverProvider)}`)
      }
    }

    const named = await finishMissingName(result, extra?.fullName)
    const outcome = clerkSessionOutcome(named)
    if (outcome.kind === 'cancelled') return { cancelled: true }
    if (outcome.kind === 'missing_requirements') {
      throw new Error('Add your name on Create account, then try Apple, Google, or Facebook again.')
    }
    if (outcome.kind === 'needs_more') {
      throw new Error('This Clerk account still needs another step. Use email and password, or finish the step in Clerk.')
    }
    if (outcome.kind !== 'session') {
      throw new Error('Social sign-in did not finish. Email and password still work.')
    }

    let token: string | null = null
    if (named.setActive) {
      await named.setActive({
        session: outcome.sessionId,
        navigate: async ({ session }) => {
          if (session?.currentTask) {
            throw new Error('Clerk still has a required step on this account. Use email and password, or finish that step in Clerk.')
          }
          token = await session.getToken()
        },
      })
    }
    if (!token) {
      const key = clerkPublishableKey()
      token = await getClerkInstance(key ? { publishableKey: key } : undefined).session?.getToken() ?? null
    }
    if (!token) throw new Error('Clerk did not return a session token.')

    await exchangeClerkSession(client, { token, promoCode: extra?.promo })
    // Only report success once the rider account actually loads (profile row
    // read or created). Otherwise the UI would land half signed in again.
    const account = await checkAccountLoads()
    if (!account.ok) {
      throw new Error(account.reason === 'offline'
        ? 'Signed in, but your account could not load. Check your connection and try again.'
        : `Signed in, but your account could not load${account.message ? `: ${account.message}` : ''}.`)
    }
    return { cancelled: false }
}
