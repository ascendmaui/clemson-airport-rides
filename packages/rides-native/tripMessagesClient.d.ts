export type RideChatMode = 'compose' | 'readonly' | 'closed'

export const RIDE_CHAT_QUICK_REPLIES: readonly string[]

export type TripChatRow = {
  id: string
  status?: string | null
  rider_id?: string | null
  driver_id?: string | null
  completed_at?: string | null
  canceled_at?: string | null
}

export type TripMessageRow = {
  id: string
  trip_id?: string
  sender_id: string
  body: string
  created_at: string
  read_at?: string | null
}

export function canonicalQuickReply(phrase: unknown): string | null
export function messageLimitForMode(mode: RideChatMode): number
export function normalizeMessageBody(body: unknown): string
export const LOST_ITEM_THREAD_WINDOW_MS: number
export const LOST_ITEM_DESCRIPTION_MAX: number

export type LostItemReport = {
  id: string
  trip_id?: string
  reporter_id: string
  reporter_role?: 'rider' | 'driver' | null
  description?: string | null
  status?: 'open' | 'resolved' | string | null
  opened_at?: string | null
  resolved_at?: string | null
  resolved_by?: string | null
}

export function canSendTripMessage(
  trip: { status?: string | null } | null | undefined,
  now?: number,
  report?: LostItemReport | null,
): boolean
export function canOpenLostItemReport(
  trip: { status?: string | null; completed_at?: string | null; completedAt?: string | null } | null | undefined,
  now?: number,
  role?: 'rider' | 'driver' | null,
): boolean
export function lostItemReportState(
  report: LostItemReport | null | undefined,
  now?: number,
): 'none' | 'open' | 'resolved' | 'expired'
export function tripPartyRole(
  trip: { rider_id?: string | null; driver_id?: string | null; riderId?: string | null; driverId?: string | null } | null | undefined,
  userId: string | null | undefined,
): 'rider' | 'driver' | null
export function normalizeLostItemDescription(description: unknown): string | null

export function rideChatMode(
  trip: { status?: string | null; completed_at?: string | null; canceled_at?: string | null } | null | undefined,
  now?: number,
  report?: LostItemReport | null,
): RideChatMode
export function rideChatBanner(
  mode: RideChatMode,
  report?: LostItemReport | null,
  now?: number,
): string | null

export function fetchTripChat(supabase: unknown, tripId: string): Promise<TripChatRow | null>
export function listTripMessages(supabase: unknown, tripId: string, limit?: number): Promise<TripMessageRow[]>
export function sendTripMessage(supabase: unknown, input: { tripId: string; body: string }): Promise<TripMessageRow>
export function sendTripQuickReply(supabase: unknown, input: { tripId: string; phrase: string }): Promise<TripMessageRow>
export function markTripMessagesRead(supabase: unknown, ids: string[] | null | undefined): Promise<{ id: string; read_at: string }[]>
export function subscribeTripMessages(supabase: unknown, tripId: string, onChange?: (payload?: unknown) => void): () => void
export function subscribeTripChatStatus(supabase: unknown, tripId: string, onChange?: (row?: unknown) => void): () => void
export function messageLimitForTrip(
  trip: { status?: string | null; completed_at?: string | null; canceled_at?: string | null } | null | undefined,
  now?: number,
  report?: LostItemReport | null,
): number
export function fetchLostItemReport(supabase: unknown, tripId: string): Promise<LostItemReport | null>
export function openLostItemReport(
  supabase: unknown,
  input: { tripId: string; description?: string | null },
): Promise<LostItemReport>
export function resolveLostItemReport(supabase: unknown, reportId: string): Promise<{ id: string; status: string }>
export function unreadCountForTrip(supabase: unknown, tripId: string, userId: string): Promise<number>
export function notifyTripMessage(supabase: unknown, input: { tripId: string; messageId: string }): Promise<void>
export function notifyLostItemReport(supabase: unknown, input: { tripId: string; reportId: string }): Promise<void>
export function subscribeLostItemReports(supabase: unknown, onChange?: (payload?: unknown) => void): () => void
