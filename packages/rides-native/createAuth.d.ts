import type { ReactNode } from 'react'

export type AuthUser = {
  id: string
  email?: string | null
  user_metadata?: {
    full_name?: string
    name?: string
    promo_code?: string
  }
}

export type AuthSession = {
  user: AuthUser
  access_token?: string
}

export type AuthApi = {
  session: AuthSession | null
  user: AuthUser | null
  loading: boolean
  configured: boolean
  signIn: (email: string, password: string) => Promise<{ session: AuthSession | null; user: AuthUser | null }>
  signUp: (
    email: string,
    password: string,
    fullName?: string,
    promoCode?: string,
  ) => Promise<{
    session: AuthSession | null
    user: AuthUser | null
    promoClaim?: { error?: string; claimed?: boolean } | null
  }>
  signOut: () => Promise<void>
}

export function createAuth(opts: {
  supabase: unknown
  supabaseConfigured: boolean
  storage: {
    getItem: (key: string) => Promise<string | null>
    setItem: (key: string, value: string) => Promise<void>
    removeItem: (key: string) => Promise<void>
  }
}): {
  AuthProvider: (props: { children: ReactNode }) => ReactNode
  useAuth: () => AuthApi
}
