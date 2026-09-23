export function apiBase(): string

export function authedJson(
  supabase: { auth: { getSession: () => Promise<{ data: { session: { access_token?: string } | null } }> } } | null,
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<Record<string, unknown>>
