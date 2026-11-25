export function loadPayoutDesk(supabase: unknown): Promise<Record<string, any>>

export function startPayoutSetup(supabase: unknown): Promise<{
  url?: string | null
  [key: string]: any
}>

export function cashOutPayout(
  supabase: unknown,
  input: { method: string; feeCents?: number },
): Promise<{
  ok?: boolean
  pendingApproval?: boolean
  method?: string
  netCents?: number
  error?: string
  [key: string]: any
}>
