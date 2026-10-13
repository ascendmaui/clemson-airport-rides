export const TIGER_PASS_NAME: string

export function tigerPassCopy(name?: string): {
  name: string
  productId: string
  kicker: string
  discountLabel: string
  priceLabel: string
  summary: string
  carTypesLabel: string
  driversLabel: string
  savedDriversLabel: string
  demoNote: string
}

export type TigerPassCarType = { id: string; name: string }

export type TigerPassStatus = {
  productId: string
  name: string
  priceCents: number
  discountBps: number
  discountPct: number
  active: boolean
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  preferredDriverIds: string[]
  preferredCarTypes: string[]
  favoriteDriverIds: string[]
  carTypes: TigerPassCarType[]
  summary: string
  priceLabel: string
  demoNote: string
  renameHook: string
  demoDriversIgnored?: boolean
  url?: string
  id?: string
}

export function loadTigerPass(supabase: unknown): Promise<TigerPassStatus>
export function saveTigerPassPreferences(
  supabase: unknown,
  body: { preferredDriverIds?: string[]; preferredCarTypes?: string[] },
): Promise<TigerPassStatus>
export function startTigerPassCheckout(
  supabase: unknown,
  body?: { origin?: string; successUrl?: string; cancelUrl?: string },
): Promise<TigerPassStatus>
export function confirmTigerPass(supabase: unknown, sessionId: string): Promise<TigerPassStatus>
export function cancelTigerPass(supabase: unknown): Promise<TigerPassStatus>
export function setFavoriteDrivers(supabase: unknown, driverIds: string[]): Promise<TigerPassStatus>
