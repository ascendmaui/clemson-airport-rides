import { supabase } from './supabase'
import { displayFirstName } from './privacyDisplay'
import {
  canonicalQuickReply,
  messageLimitForMode,
  normalizeMessageBody,
  rideChatMode,
} from './tripChatRules'

export {
  canonicalQuickReply,
  messageLimitForMode,
  normalizeMessageBody,
  rideChatMode,
  RIDE_CHAT_QUICK_REPLIES,
} from './tripChatRules'

const MESSAGE_COLS = 'id, trip_id, sender_id, body, created_at, read_at'
const TRIP_COLS = 'id, status, rider_id, driver_id, completed_at, canceled_at'

export async function fetchTripChat(tripId) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('trips')
    .select(TRIP_COLS)
    .eq('id', tripId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function fetchCounterpartFirstName(counterpartId, fallback) {
  if (!supabase || !counterpartId) return fallback
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', counterpartId)
    .maybeSingle()
  if (error || !data) return fallback
  return displayFirstName(data.full_name, fallback)
}

export async function listTripMessages(tripId, limit) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('trip_messages')
    .select(MESSAGE_COLS)
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data || []).slice().reverse()
}

export async function sendTripMessage({ tripId, body }) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError) throw new Error(authError.message)
  const senderId = authData?.user?.id
  if (!senderId) throw new Error('Sign in to message')
  const clean = normalizeMessageBody(body)
  const { data, error } = await supabase
    .from('trip_messages')
    .insert({ trip_id: tripId, sender_id: senderId, body: clean })
    .select(MESSAGE_COLS)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function sendTripQuickReply({ tripId, phrase }) {
  const exact = canonicalQuickReply(phrase)
  if (!exact) throw new Error('Unknown quick reply')
  return sendTripMessage({ tripId, body: exact })
}

export async function markTripMessagesRead(ids) {
  if (!supabase || !ids?.length) return []
  const readAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('trip_messages')
    .update({ read_at: readAt })
    .in('id', ids)
    .is('read_at', null)
    .select('id, read_at')
  if (error) throw new Error(error.message)
  return data || []
}

export function subscribeTripMessages(tripId, onChange) {
  if (!supabase || !tripId) return () => {}
  const channel = supabase
    .channel(`trip-messages-${tripId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'trip_messages',
        filter: `trip_id=eq.${tripId}`,
      },
      (payload) => onChange?.(payload),
    )
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}

export function subscribeTripChatStatus(tripId, onChange) {
  if (!supabase || !tripId) return () => {}
  const channel = supabase
    .channel(`trip-chat-status-${tripId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'trips',
        filter: `id=eq.${tripId}`,
      },
      (payload) => onChange?.(payload?.new || null),
    )
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}

export function messageLimitForTrip(trip, now) {
  return messageLimitForMode(rideChatMode(trip, now))
}
