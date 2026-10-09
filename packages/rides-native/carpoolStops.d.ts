export type StopRider = { id: string; name: string; fareCents: number }
export type StopFare = { participantId: string; fareCents: number; capturedCents: number; status: 'captured' | 'comped' | 'pending' | 'unpaid'; paymentId?: string | null }
export type TripStop = {
  index: number
  kind: 'pickup' | 'dropoff'
  label: string
  lat: number | null
  lng: number | null
  participantIds: string[]
  riders: StopRider[]
  status: 'pending' | 'arrived' | 'done'
  arrivedAt: string | null
  doneAt: string | null
  fares: StopFare[]
}
export type StopOp = 'arrive' | 'start' | 'drop'
export function tripStops(trip: unknown): TripStop[]
export function isMultiStopTrip(trip: unknown): boolean
export function nextStopIndex(stops: TripStop[]): number
export function allStopsDone(stops: TripStop[]): boolean
export function stopFlowStarted(trip: unknown): boolean
export function stopNextOp(stop: TripStop | null | undefined): StopOp | null
export function applyStopOp(stops: TripStop[], input: { index: number; op: StopOp; at?: string }): { stops?: TripStop[]; stop?: TripStop; idempotent?: boolean; error?: string; nextIndex?: number }
export function stopTitle(stop: TripStop | null | undefined): string
export function stopActionLabel(stop: TripStop | null | undefined): string | null
export function stopStatusLabel(stop: TripStop | null | undefined): string
export function fareCaptureLine(fare: StopFare | null | undefined, name?: string): string
