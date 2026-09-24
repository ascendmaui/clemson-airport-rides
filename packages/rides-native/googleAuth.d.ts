export const DRIVER_GOOGLE_PROVIDER: { id: 'google'; label: string }[]

export function googleOAuthRedirect(scheme?: string, path?: string): string

export function startGoogleOAuth(supabase: {
  auth: {
    signInWithOAuth: (args: unknown) => Promise<{ data: { url?: string | null } | null; error: { message?: string } | null }>
  }
}, redirectTo: string): Promise<string>

export function completeGoogleSession(supabase: unknown, callbackUrl: string): Promise<unknown>
