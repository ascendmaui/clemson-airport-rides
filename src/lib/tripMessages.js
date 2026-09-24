import { supabase } from './supabase'
import { displayFirstName } from './privacyDisplay'
import {
  fetchTripChat as fetchChat,
  listTripMessages as listMessages,
  markTripMessagesRead as markRead,
  messageLimitForTrip as limitForTrip,
  sendTripMessage as sendMessage,
  sendTripQuickReply as sendQuick,
  subscribeTripChatStatus as subscribeStatus,
  subscribeTripMessages as subscribeMessages,
} from '../../packages/rides-native/tripMessagesClient.js'

export {
  canonicalQuickReply,
  messageLimitForMode,
  normalizeMessageBody,
  rideChatMode,
  rideChatBanner,
  RIDE_CHAT_QUICK_REPLIES,
} from './tripChatRules'

export function fetchTripChat(tripId) {
  return fetchChat(supabase, tripId)
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

export function listTripMessages(tripId, limit) {
  return listMessages(supabase, tripId, limit)
}

export function sendTripMessage(input) {
  return sendMessage(supabase, input)
}

export function sendTripQuickReply(input) {
  return sendQuick(supabase, input)
}

export function markTripMessagesRead(ids) {
  return markRead(supabase, ids)
}

export function subscribeTripMessages(tripId, onChange) {
  return subscribeMessages(supabase, tripId, onChange)
}

export function subscribeTripChatStatus(tripId, onChange) {
  return subscribeStatus(supabase, tripId, onChange)
}

export function messageLimitForTrip(trip, now) {
  return limitForTrip(trip, now)
}
