export const PAYOUT_SWEEP_UTC_HOUR: number

export type TipPayment = {
  kind?: string
  amountCents?: number
  amount_cents?: number
  status?: string
}

export type DashTrip = {
  id: string
  status?: string
  fare_cents?: number
  canceled_at?: string | null
  completed_at?: string | null
  wait_fee_cents?: number
  cancel_fee_cents?: number
  driver_wait_earnings_cents?: number
  pickup_label?: string | null
  dropoff_label?: string | null
  metadata?: Record<string, unknown> | null
  boost_cents?: number | null
  boostCents?: number | null
}

export type TipsBreakdown = {
  tipCents: number
  tippedRides: number
  completedRides: number
  averageTipCents: number
  shareOfTake: number
  rides: { tripId: string; label: string; tipCents: number; at: string | null }[]
}

export type StreakCard = {
  id: 'trips' | 'days'
  title: string
  unit: string
  current: number
  target: number
  toNext: number
  progress: number
  bonusCents: number
}

export type BonusRow = {
  kind: string
  label: string
  amountCents: number
  status: string
  at: string | null
}

export type StreakBoard = {
  available: boolean
  cards: StreakCard[]
  bonuses: BonusRow[]
}

export type StreakView = {
  enabled?: boolean
  current?: number
  target?: number
  toNext?: number
  progress?: number
  bonusCents?: number
}

export type DriverPerks = {
  streaks?: { trips?: StreakView; days?: StreakView }
  bonuses?: { kind?: string; amountCents?: number; amount_cents?: number; status?: string; at?: string | null }[]
}

export type ForecastSlot = {
  zone?: string
  zoneLabel?: string
  startsAt: string
  endsAt: string
  expectedCentsPerHour?: number
  confidence?: string
  reasons?: string[]
}

export type ForecastPayload = {
  lowData?: boolean
  disclaimer?: string
  eventsNote?: string | null
  top?: ForecastSlot[]
}

export type ForecastHour = {
  zone?: string
  zoneLabel: string
  window: string
  startsAt: string
  expectedCentsPerHour: number
  confidence: string
  reasons: string[]
}

export type ForecastZone = {
  zone?: string
  zoneLabel: string
  window: string
  expectedCentsPerHour: number
}

export type ForecastHighlights = {
  available: boolean
  lowData: boolean
  disclaimer: string
  eventsNote: string | null
  hours: ForecastHour[]
  zones: ForecastZone[]
}

export type PayoutHistoryRow = {
  id: string
  label: string
  amountCents: number
  status: string
  at: string | null
  lastError: string | null
  kind: 'trip' | 'bonus'
}

export type PayoutTimeline = {
  pendingCents: number
  paidCents: number
  waitingCents: number
  etaAt: number | null
  history: PayoutHistoryRow[]
}

export type RideDetail = {
  id: string
  status?: string
  at: string | null
  pickup: string
  dropoff: string
  netCents: number
  payoutCents: number
  tipCents: number
  boostCents: number
  carpoolBonusCents: number
  payoutStatus: string | null
}

export function tipCents(payments: TipPayment[] | null | undefined): number
export function tipsBreakdown(
  trips: DashTrip[] | null | undefined,
  paymentsByTrip: Record<string, TipPayment[]> | null | undefined,
): TipsBreakdown
export function bonusLabel(kind: string): string
export function streakBoard(perks: DriverPerks | null | undefined): StreakBoard
export function formatBestWindow(slot: { startsAt?: string; endsAt?: string } | null | undefined, timeZone?: string): string
export function forecastHighlights(forecast: ForecastPayload | null | undefined, limit?: number): ForecastHighlights
export function nextDailyPayoutAt(notBeforeMs: number): number | null
export function payoutTimeline(input?: {
  trips?: DashTrip[] | null
  payouts?: { paidCents?: number; pendingCents?: number; pending?: unknown[] } | null
  bonuses?: BonusRow[] | null
  now?: number
}): PayoutTimeline
export function formatPayoutEta(etaAt: number | null, timeZone?: string): string
export function rideDetails(
  trips: DashTrip[] | null | undefined,
  paymentsByTrip: Record<string, TipPayment[]> | null | undefined,
): RideDetail[]
