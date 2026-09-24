export const AIRPORT_CHOICES: { code: 'GSP' | 'CLT'; name: string }[]

export type AirportQuote = {
  fareCents: number
  cashCents: number
  depositCents: number
  studentDiscountCents: number
  surgeMultiplier: number
  surgeLabel: string | null
  routeSource: string | null
  source?: string
}

export type CheckoutSession = {
  url?: string
  tripId?: string
  depositCents?: number
  fareCents?: number
  paidWithCredits?: boolean
}

export function quoteInputKey(input?: { airport?: string; date?: string; time?: string }): string

export function quoteAirportFare(
  supabase: unknown,
  input?: { airport?: string; date?: string; time?: string; isStudent?: boolean },
): Promise<AirportQuote>

export function startAirportDeposit(
  supabase: unknown,
  input?: {
    airport?: string
    date?: string
    time?: string
    fareCents?: number
    depositCents?: number
    studentDiscountCents?: number
    riderId?: string
    riderName?: string
  },
): Promise<CheckoutSession>

export function studentStatus(input?: { email?: string | null; studentVerifiedAt?: string | null }): {
  verified: boolean
  viaEmail: boolean
  verifiedAt: string | null
  discountLabel: string | null
}

export function loadStudentProfile(
  supabase: unknown,
  userId: string,
): Promise<{ studentVerifiedAt: string | null; email: string | null; error: string | null }>

export function markStudentVerified(
  supabase: unknown,
  user: { id: string; email?: string | null },
): Promise<{ verified: boolean; verifiedAt?: string; error: string | null }>

export function loadTripDeposit(
  supabase: unknown,
  tripId: string,
): Promise<{ settled: boolean; error: string | null }>

export function loadRiderBilling(
  supabase: unknown,
  userId: string,
): Promise<{
  card: { brand: string; last4: string | null; billingActivatedAt: string | null } | null
  deposits: { id: string; amount_cents: number | null; status: string | null; created_at: string | null; trip_id: string | null }[]
  rides: {
    id: string
    status: string | null
    pickup_label: string | null
    dropoff_label: string | null
    fare_cents: number | null
    deposit_cents: number | null
    created_at: string | null
  }[]
  profileError: string | null
  paymentsError: string | null
  ridesError: string | null
}>

export function loadPromoDesk(
  supabase: unknown,
  userId: string,
): Promise<{
  code: string | null
  config: {
    referrer_credit_cents?: number
    referred_discount_kind?: string
    referred_percent_off?: number
    referred_cents_off?: number
  } | null
  sent: { id: string; status: string | null }[]
  received: { code?: string | null; status?: string | null } | null
  error: string | null
}>

export function claimPromoCode(
  supabase: unknown,
  code: string,
): Promise<{ error?: string; claimed?: boolean; reason?: string }>

export function promoClaimMessage(result: { error?: string; claimed?: boolean; reason?: string } | null): string

export function describeRiderSocialRewards(cfg?: object | null): { referrer: string; referred: string }

export function riderPromoShareUrl(code: string): string
export function riderPromoShareText(code: string): string
