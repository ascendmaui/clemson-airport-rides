export type LostFoundTrip = {
  id: string
  completedAt?: string | null
  pickup: string
  dropoff: string
  otherId: string
  otherFirstName: string
  otherRole: 'driver' | 'rider'
}

export type LostFoundChoices = {
  canConfirmFound: boolean
  canConfirmNotFound: boolean
  canMessage: boolean
  canSupportNote: boolean
  canMarkReturned: boolean
  canClose: boolean
  canWithdraw: boolean
}

export type LostFoundMessage = {
  id: string
  body: string
  createdAt: string
  mine: boolean
  senderFirstName: string
}

export type LostFoundReport = {
  id: string
  tripId?: string
  status: string
  resolution?: string | null
  itemDescription: string
  supportNote?: string
  createdAt?: string
  claimedAt?: string | null
  returnedAt?: string | null
  closedAt?: string | null
  reporterId?: string
  counterpartId?: string
  reporterFirstName: string
  counterpartFirstName: string
  pickup: string
  dropoff: string
  completedAt?: string | null
  hasRideChat?: boolean
  mine: boolean
  messages?: LostFoundMessage[]
  choices?: LostFoundChoices
}

export function statusLabel(status: unknown): string
export function resolutionLabel(resolution: unknown): string

export function fetchRecentLostFoundTrips(supabase: unknown, userId: string | null | undefined): Promise<LostFoundTrip[]>
export function listLostFoundReports(supabase: unknown, userId: string | null | undefined): Promise<LostFoundReport[]>
export function fetchLostFoundReport(
  supabase: unknown,
  reportId: string,
  userId: string,
): Promise<LostFoundReport | null>
export function createLostFoundReport(
  supabase: unknown,
  input: { tripId: string; reporterId: string; counterpartId: string; description?: string },
): Promise<{ id: string }>
export function confirmFound(supabase: unknown, reportId: string): Promise<void>
export function confirmNotFound(supabase: unknown, reportId: string): Promise<void>
export function markReturned(supabase: unknown, reportId: string): Promise<void>
export function closeLostFoundReport(supabase: unknown, reportId: string): Promise<void>
export function saveSupportNote(supabase: unknown, reportId: string, note: string): Promise<void>
export function sendLostFoundMessage(
  supabase: unknown,
  input: { reportId: string; senderId: string; body: string },
): Promise<void>
