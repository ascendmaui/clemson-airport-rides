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
export function rideChatMode(
  trip: { status?: string | null; completed_at?: string | null; canceled_at?: string | null } | null | undefined,
  now?: number,
): RideChatMode
export function rideChatBanner(mode: RideChatMode): string | null

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
): number
