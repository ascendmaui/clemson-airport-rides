import type { ReactNode } from 'react'

type Storage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

export type SocialProvider = {
  id: 'apple' | 'google' | 'facebook'
  label: string
}

export function SignInScreen(props: {
  signIn: (email: string, password: string) => Promise<unknown>
  onSuccess: () => void
  onCreateAccount: () => void
  onForgotPassword?: () => void
  onBack: () => void
  subtitle?: string
  mark?: string
  socialProviders?: SocialProvider[]
  onSocial?: (providerId: SocialProvider['id']) => Promise<{ cancelled?: boolean } | void>
  resetPassword?: (email: string) => Promise<unknown>
}): ReactNode

export function ForgotPasswordScreen(props: {
  resetPassword: (email: string) => Promise<unknown>
  onBack: () => void
  onSignIn: () => void
  mark?: string
}): ReactNode

export function SetNewPasswordScreen(props: {
  updatePassword: (password: string) => Promise<unknown>
  onSuccess: () => void
  onBack: () => void
  ready?: boolean
  statusNote?: string | null
  mark?: string
}): ReactNode

export function SignUpScreen(props: {
  signUp: (email: string, password: string, fullName?: string, promoCode?: string) => Promise<{
    session?: unknown
    promoClaim?: { error?: string } | null
  }>
  storage: Storage
  onSuccess: () => void
  onSignIn: () => void
  onBack: () => void
  initialPromo?: string
  subtitle?: string
  mark?: string
  socialProviders?: SocialProvider[]
  onSocial?: (
    providerId: SocialProvider['id'],
    extra?: { promo?: string; fullName?: string },
  ) => Promise<{ cancelled?: boolean } | void>
}): ReactNode

export function ResetPasswordScreen(props: {
  updatePassword: (password: string) => Promise<unknown>
  onSuccess: () => void
  onBack: () => void
  subtitle?: string
  mark?: string
}): ReactNode
