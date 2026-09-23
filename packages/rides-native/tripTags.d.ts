export const TESLA_FLEET_NOTICE: string
export const ACTIONABLE_LEAD_MS: number

export type TripTag = 'student' | 'game_day' | 'weekend_party' | 'tesla' | 'direct' | 'scheduled'
export type QueueFilter = 'all' | 'student' | 'game_day' | 'weekend_party'

export type DriverCard = {
  id: string
  status: string
  driverId: string | null
  riderId: string | null
  pickupLabel: string
  dropoffLabel: string
  pickupAt: string | null
  pickupLat: number | null
  pickupLng: number | null
  dropoffLat: number | null
  dropoffLng: number | null
  fareCents: number
  depositCents: number
  driverNetCents: number
  firstName: string
  purpose: string
  tier: string | null
  tags: TripTag[]
  tagLabels: string[]
  teslaStub: boolean
  arrivedAt: string | null
}

export type PaymentRow = {
  kind?: string
  amountCents?: number
  amount_cents?: number
  status?: string
}

export function formatCents(cents: number): string
export function driverNetCents(fareCents: number): number
export function depositSliceCents(fareCents: number, stored?: number | string | null): number
export function zonedWeekdayHour(iso: string | null | undefined, timeZone?: string): { weekday: string; hour: number } | null
export function isWeekendPartyWindow(iso: string | null | undefined): boolean
export function formatPickupAt(iso: string | null | undefined): string
export function isSameZonedDay(iso: string | null | undefined, now?: Date, timeZone?: string): boolean
export function isDueNow(trip: { pickupAt?: string | null; pickup_at?: string | null; scheduled_for?: string | null } | null, now?: Date): boolean
export const TAG_LABELS: Record<string, string>
export function tagLabel(id: string): string
export function tripTags(row: Record<string, unknown> | null | undefined, options?: { gameDayLive?: boolean }): TripTag[]
export function isActiveStatus(status: string): boolean
export function nextTripStatus(status: string): string | null
export function statusActionLabel(status: string): string | null
export function statusHeadline(status: string): string
export function toDriverCard(row: Record<string, unknown> | null | undefined, options?: { gameDayLive?: boolean }): DriverCard | null
export function matchesQueueFilter(card: { tags: string[] } | null, filter: QueueFilter): boolean
export function queueFilters(): QueueFilter[]
export function depositStatusLine(payments: PaymentRow[] | null | undefined): string | null
export function summarizeDepositAwareness(
  trips: Array<{ id: string; status?: string; fare_cents?: number; completed_at?: string | null; dropoff_label?: string | null }> | null | undefined,
  paymentsByTrip: Record<string, PaymentRow[]> | null | undefined,
  now?: Date,
): {
  depositPaidCents: number
  depositOpenCents: number
  driverNetCents: number
  todayNetCents: number
  lines: { tripId: string; dropoff: string; line: string; fareCents: number }[]
}
