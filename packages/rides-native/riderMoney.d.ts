export { authedJson } from './apiClient.js'

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
  tigerPassApplied?: boolean
  tigerPassName?: string | null
  tigerPassDiscountBps?: number
  tigerPassDiscountCents?: number
  preferredCarTypes?: string[]
  tiers?: { id: string; fareCents: number; discountCents?: number; tigerPassApplied?: boolean; tigerPassDiscountCents?: number }[]
}

export function withTigerPassQuote<T extends { fareCents?: number; depositCents?: number; tigerPassApplied?: boolean }>(
  quote: T,
  input?: { active?: boolean; bps?: number; name?: string },
): T & {
  tigerPassApplied: boolean
  tigerPassName: string | null
  tigerPassDiscountBps: number
  tigerPassDiscountCents: number
  fareCents: number
  depositCents: number
}

export function fetchRideQuote(
  supabase: unknown,
  body?: {
    pickupLabel?: string
    pickupLat?: number
    pickupLng?: number
    dest?: string
    destLat?: number
    destLng?: number
    airport?: string
    date?: string
    time?: string
    tier?: string
  },
): Promise<AirportQuote>

export type CheckoutSession = {
  id?: string
  url?: string
  tripId?: string
  depositCents?: number
  fareCents?: number
  paidWithCredits?: boolean
}

export type CheckoutCloseResult = {
  ok?: boolean
  released?: boolean
  restored?: boolean
  reason?: string
  status?: string
}

export function checkoutCloseOutcome(
  result: CheckoutCloseResult | null | undefined,
): 'paid' | 'released' | 'unchanged' | 'unknown'

export function abandonAirportCheckout(
  supabase: unknown,
  input?: { tripId?: string; sessionId?: string },
): Promise<CheckoutCloseResult>

export function reconcileCheckout(
  supabase: unknown,
  sessionId: string | { sessionId?: string; session_id?: string },
): Promise<{ ok: boolean; paid?: boolean; alreadyRecorded?: boolean; tripId?: string; error?: string }>

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

export const STUDENT_DISCOUNT_LABEL: string
export const STUDENT_EMAIL_HINT: string
export const STUDENT_CLAIM_COPY: string
export const STUDENT_EMAIL_REQUIRED_COPY: string
export const STUDENT_CONFIRM_EMAIL_COPY: string

export function displayTierPrice(
  priceDollars: number,
  input?: { isStudent?: boolean; tier?: string; surgeMultiplier?: number },
): {
  price: number
  discount: number
  label: string | null
  fareCents: number
  discountCents: number
}

export function studentTripMeta(input?: {
  isStudent?: boolean
  tier?: string
  fareCents?: number
}): { isStudent?: boolean; studentLabel?: string; student_discount_cents?: number }

export function studentStatus(input?: {
  email?: string | null
  studentVerifiedAt?: string | null
  user?: { email?: string | null; email_confirmed_at?: string | null; confirmed_at?: string | null; identities?: unknown[] } | null
}): {
  verified: boolean
  viaEmail: boolean
  confirmed: boolean
  verifiedAt: string | null
  discountLabel: string | null
  gateCopy: string | null
}

export function studentSurfaceCopy(
  status: { verified?: boolean; gateCopy?: string | null } | null | undefined,
  surface: 'home' | 'tiers' | 'confirm',
): { title: string; detail: string | null; granted: boolean }

export function loadStudentProfile(
  supabase: unknown,
  userId: string,
): Promise<{ studentVerifiedAt: string | null; email: string | null; error: string | null }>

export function markStudentVerified(
  supabase: unknown,
  user: { id: string; email?: string | null },
): Promise<{ verified: boolean; verifiedAt?: string; error: string | null }>

export function depositBalance(input?: {
  fareCents?: number
  depositCents?: number | null
}): { fareCents: number; depositCents: number; remainingCents: number }

export type DepositSurface = 'quote' | 'confirm' | 'receipt' | 'upcoming'

export function depositSurfaceCopy(
  input: { fareCents?: number; depositCents?: number | null; remainingCents?: number },
  surface: DepositSurface,
  extra?: { studentDiscountCents?: number },
): string | null

export function depositReceiptLines(trip: {
  fare_cents?: number | null
  deposit_cents?: number | null
}): string[]

export function formatUsdCents(cents: number): string

export function airportCodeFromLabel(label?: string | null): 'GSP' | 'CLT' | null

export function quoteInputKey(input?: { airport?: string; date?: string; time?: string }): string

export function quoteAtIso(
  input?: { date?: string; time?: string; timeZone?: string },
  now?: Date,
): string

export function previewAirportFare(input?: {
  airport?: string
  date?: string
  time?: string
  isStudent?: boolean
  at?: Date
}): AirportQuote

export const STRIPE_NOT_CONFIGURED_COPY: string

export function checkoutFailureCopy(err: unknown): string

export function loadTripDeposit(
  supabase: unknown,
  tripId: string,
): Promise<{ settled: boolean; error: string | null }>

export const ADD_ANOTHER_PAYMENT_METHOD_ID: string
export const ADD_ANOTHER_PAYMENT_METHOD_LABEL: string

export function googlePayTestEnv(publishableKey: string | null | undefined): boolean

export function nativeSetupSheetParams(
  methodId: string,
  options?: { testEnv?: boolean },
): {
  merchantDisplayName: string
  returnURL: string
  primaryButtonLabel: string
  allowsDelayedPaymentMethods: boolean
  paymentMethodOrder: string[]
  link: { display: 'automatic' | 'never' }
  applePay?: { merchantCountryCode: string }
  googlePay?: { merchantCountryCode: string; currencyCode: string; testEnv: boolean }
}

export function nativeWalletUnavailableCopy(methodId: string): string

export function savedPaymentMethodLabel(method: {
  brand?: string | null
  last4?: string | null
  type?: string | null
  cashtag?: string | null
  email?: string | null
} | null): string

export type RidePaymentMethod = {
  id: string
  label: string
  stripeType: string
  wallets: { applePay: 'auto' | 'never'; googlePay: 'auto' | 'never' }
}

export const RIDE_PAYMENT_METHODS: RidePaymentMethod[]

export function prepaidPurchaseSummary(tier: {
  priceCents: number
  creditCents: number
} | null): {
  creditCents: number
  bonusCents: number
  chargedCents: number
  grantedCents: number
  credit: string
  bonus: string
  charged: string
  granted: string
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
} | null

export function prepaidCreditsFromPayload(data: {
  balanceCents?: number
  unavailable?: boolean
  tiers?: unknown[]
} | null): {
  balanceCents: number | null
  unavailable: boolean
  tiers: unknown[]
}

export function loadPrepaidCredits(supabase: unknown): Promise<{
  balanceCents: number | null
  unavailable: boolean
  tiers: { id: string; label?: string; priceCents: number; creditCents: number }[]
  error: string | null
}>

export function buyPrepaidCredits(supabase: unknown, tierId: string): Promise<{
  ok?: boolean
  balanceCents?: number
  grantedCents?: number
  error?: string
}>

export function startPaymentMethodSetup(
  supabase: unknown,
  input?: { paymentMethod?: string; returnUrl?: string; native?: boolean },
): Promise<{
  url?: string
  sessionId?: string
  clientSecret?: string
  setupIntentId?: string
  publishableKey?: string | null
  merchantIdentifier?: string | null
  error?: string
  note?: string
}>

export function saveCheckoutPaymentMethod(
  supabase: unknown,
  checkoutSessionId: string,
): Promise<{ ok?: boolean; brand?: string; last4?: string }>

export function saveSetupPaymentMethod(
  supabase: unknown,
  setupIntentId: string,
): Promise<{ ok?: boolean; brand?: string; last4?: string; paymentMethodId?: string }>

export type SavedPaymentMethod = {
  id: string
  brand: string
  last4: string | null
  type?: string
  cashtag?: string | null
  email?: string | null
}

export function listSavedPaymentMethods(supabase: unknown): Promise<{
  methods?: SavedPaymentMethod[]
  defaultPmId?: string | null
  error?: string
}>

export function updateSavedPaymentMethod(
  supabase: unknown,
  input: { action: 'default' | 'detach'; paymentMethodId: string },
): Promise<{
  ok?: boolean
  defaultPmId?: string | null
  brand?: string | null
  last4?: string | null
  methods?: SavedPaymentMethod[]
}>

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
