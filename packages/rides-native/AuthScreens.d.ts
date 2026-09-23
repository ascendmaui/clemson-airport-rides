import type { ReactNode } from 'react'

type Storage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

export function SignInScreen(props: {
  signIn: (email: string, password: string) => Promise<unknown>
  onSuccess: () => void
  onCreateAccount: () => void
  onBack: () => void
  subtitle?: string
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
}): ReactNode
