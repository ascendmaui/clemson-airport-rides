export function googleOAuthRedirect(scheme?: string, path?: string): string

export function startGoogleOAuth(supabase: {
  auth: {
    signInWithOAuth: (args: {
      provider: 'google'
      options?: {
        redirectTo?: string
        skipBrowserRedirect?: boolean
        queryParams?: { [key: string]: string }
      }
    }) => Promise<{ data: { url?: string | null } | null; error: { message?: string } | null }>
  }
} | null, redirectTo: string): Promise<string>

export function completeGoogleSession(supabase: unknown, callbackUrl: string): Promise<unknown>
