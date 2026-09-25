export function apiBase(): string

export function authedJson<T = Record<string, unknown>>(
  supabase: unknown,
  path: string,
  options?: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
    fetch?: typeof fetch
  },
): Promise<T>

