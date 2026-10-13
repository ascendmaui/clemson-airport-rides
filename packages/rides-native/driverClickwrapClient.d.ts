export const CLICKWRAP_STORAGE_KEY: string
export const DRIVER_CLICKWRAP_VERSION: string

export function fetchClickwrapStatus(supabase: unknown): Promise<{
  requiredVersion: string
  accepted: boolean
  acceptance: {
    userId: string
    agreementVersion: string
    acceptedAt: string
    appVersion: string | null
    ip: string | null
  } | null
}>

export function submitDriverClickwrap(
  supabase: unknown,
  options?: { appVersion?: string | null },
): Promise<{
  accepted: boolean
  requiredVersion: string
  acceptance: {
    userId: string
    agreementVersion: string
    acceptedAt: string
    appVersion: string | null
    ip: string | null
  }
}>

export function resolveDriverClickwrap(
  supabase: unknown,
  storage: { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> } | null,
): Promise<'ok' | 'required'>

export function loadDriverClickwrapPhase(options: {
  storage?: { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> } | null
  fetchStatus: () => Promise<{ accepted?: boolean; requiredVersion?: string; acceptance?: unknown }>
  version?: string
}): Promise<'ok' | 'required'>
