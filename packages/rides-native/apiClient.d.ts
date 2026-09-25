export function apiBase(): string

export function authedJson(
  supabase: {
    auth: {
      getSession: () => Promise<{ data: { session: { access_token?: string } | null } }>
      refreshSession?: () => Promise<{ data: { session: { access_token?: string } | null } | null; error?: unknown }>
    }
  } | unknown,
  path: string,
  options?: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
    fetch?: typeof fetch
  },
): Promise<any>

