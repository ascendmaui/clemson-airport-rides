import { authedJson } from './apiClient.js'
import {
  canOpenLostItemReport,
  canonicalQuickReply,
  messageLimitForMode,
  normalizeLostItemDescription,
  normalizeMessageBody,
  rideChatMode,
  tripPartyRole,
} from '../../src/lib/tripChatRules.js'

export {
  LOST_ITEM_DESCRIPTION_MAX,
  LOST_ITEM_THREAD_WINDOW_MS,
  canOpenLostItemReport,
  canSendTripMessage,
  canonicalQuickReply,
  lostItemReportState,
  messageLimitForMode,
  normalizeLostItemDescription,
  normalizeMessageBody,
  rideChatMode,
  rideChatBanner,
  tripPartyRole,
  RIDE_CHAT_QUICK_REPLIES,
} from '../../src/lib/tripChatRules.js'

const MESSAGE_COLS = 'id, trip_id, sender_id, body, created_at, read_at'
const TRIP_COLS = 'id, status, rider_id, driver_id, completed_at, canceled_at'
const LOST_COLS = 'id, trip_id, reporter_id, reporter_role, description, status, opened_at, resolved_at, resolved_by'

function requireClient(supabase) {
  if (!supabase) throw new Error('Supabase is not configured')
}

export async function fetchTripChat(supabase, tripId) {
  requireClient(supabase)
  const { data, error } = await supabase
    .from('trips')
    .select(TRIP_COLS)
    .eq('id', tripId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function listTripMessages(supabase, tripId, limit) {
  requireClient(supabase)
  const { data, error } = await supabase
    .from('trip_messages')
    .select(MESSAGE_COLS)
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data || []).slice().reverse()
}

export async function sendTripMessage(supabase, { tripId, body }) {
  requireClient(supabase)
  const clean = normalizeMessageBody(body)
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError) throw new Error(authError.message)
  const senderId = authData?.user?.id
  if (!senderId) throw new Error('Sign in to message')
  const { data, error } = await supabase
    .from('trip_messages')
    .insert({ trip_id: tripId, sender_id: senderId, body: clean })
    .select(MESSAGE_COLS)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function sendTripQuickReply(supabase, { tripId, phrase }) {
  requireClient(supabase)
  const exact = canonicalQuickReply(phrase)
  if (!exact) throw new Error('Unknown quick reply')
  return sendTripMessage(supabase, { tripId, body: exact })
}

export async function markTripMessagesRead(supabase, ids) {
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

export function subscribeTripMessages(supabase, tripId, onChange) {
  if (!supabase || !tripId) return () => {}
  const channel = supabase
    .channel(`trip-messages-${tripId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_messages', filter: `trip_id=eq.${tripId}` },
      (payload) => onChange?.(payload),
    )
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}

export function subscribeTripChatStatus(supabase, tripId, onChange) {
  if (!supabase || !tripId) return () => {}
  const channel = supabase
    .channel(`trip-chat-status-${tripId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` },
      (payload) => onChange?.(payload?.new || null),
    )
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}

export function messageLimitForTrip(trip, now, report) {
  return messageLimitForMode(rideChatMode(trip, now, report))
}

export async function fetchLostItemReport(supabase, tripId) {
  requireClient(supabase)
  const { data, error } = await supabase
    .from('trip_lost_item_reports')
    .select(LOST_COLS)
    .eq('trip_id', tripId)
    .order('opened_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? (data[0] || null) : (data || null)
}

export async function openLostItemReport(supabase, { tripId, description }) {
  requireClient(supabase)
  const note = normalizeLostItemDescription(description)
  const trip = await fetchTripChat(supabase, tripId)
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError) throw new Error(authError.message)
  const userId = authData?.user?.id
  if (!userId) throw new Error('Sign in to report a lost item')
  const role = tripPartyRole(trip, userId)
  if (!canOpenLostItemReport(trip, Date.now(), role)) {
    throw new Error('Lost-item messaging is only available for a recently completed trip')
  }
  const { data, error } = await supabase
    .from('trip_lost_item_reports')
    .insert({
      trip_id: tripId,
      reporter_id: userId,
      reporter_role: role,
      description: note,
      status: 'open',
    })
    .select(LOST_COLS)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function resolveLostItemReport(supabase, reportId) {
  requireClient(supabase)
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError) throw new Error(authError.message)
  const userId = authData?.user?.id
  if (!userId) throw new Error('Sign in to resolve this thread')
  const { error } = await supabase
    .from('trip_lost_item_reports')
    .update({
      status: 'resolved',
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', reportId)
  if (error) throw new Error(error.message)
  return { id: reportId, status: 'resolved' }
}

export async function unreadCountForTrip(supabase, tripId, userId) {
  if (!supabase || !tripId || !userId) return 0
  const { data, error } = await supabase
    .from('trip_messages')
    .select('id')
    .eq('trip_id', tripId)
    .is('read_at', null)
    .neq('sender_id', userId)
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data.length : 0
}

export async function notifyTripMessage(supabase, { tripId, messageId }) {
  if (!supabase || !tripId || !messageId) return
  try {
    await authedJson(supabase, '/api/trip-messages?action=message', {
      method: 'POST',
      body: { tripId, messageId },
    })
  } catch {
    // The message row is already saved. Push is best-effort.
  }
}

export async function notifyLostItemReport(supabase, { tripId, reportId }) {
  if (!supabase || !tripId || !reportId) return
  try {
    await authedJson(supabase, '/api/trip-messages?action=lost-item', {
      method: 'POST',
      body: { tripId, reportId },
    })
  } catch {
    // Realtime still updates an open app when the report row lands.
  }
}

export function subscribeLostItemReports(supabase, onChange) {
  if (!supabase) return () => {}
  const channel = supabase
    .channel('trip-lost-item-reports')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_lost_item_reports' },
      (payload) => onChange?.(payload),
    )
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
