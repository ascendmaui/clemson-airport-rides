import { supabase } from './supabase'
import { displayFirstName } from './privacyDisplay'
import {
  fetchLostItemReport as fetchLost,
  fetchTripChat as fetchChat,
  listTripMessages as listMessages,
  markTripMessagesRead as markRead,
  messageLimitForTrip as limitForTrip,
  notifyLostItemReport as notifyLost,
  notifyTripMessage as notifyMessage,
  openLostItemReport as openLost,
  resolveLostItemReport as resolveLost,
  sendTripMessage as sendMessage,
  sendTripQuickReply as sendQuick,
  subscribeLostItemReports as subscribeLost,
  subscribeTripChatStatus as subscribeStatus,
  subscribeTripMessages as subscribeMessages,
  unreadCountForTrip as unreadForTrip,
} from '../../packages/rides-native/tripMessagesClient.js'

export {
  LOST_ITEM_THREAD_WINDOW_MS,
  canonicalQuickReply,
  canOpenLostItemReport,
  canSendTripMessage,
  lostItemReportState,
  messageLimitForMode,
  normalizeLostItemDescription,
  normalizeMessageBody,
  rideChatMode,
  rideChatBanner,
  tripPartyRole,
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

export function messageLimitForTrip(trip, now, report) {
  return limitForTrip(trip, now, report)
}

export function fetchLostItemReport(tripId) {
  return fetchLost(supabase, tripId)
}

export function openLostItemReport(input) {
  return openLost(supabase, input)
}

export function resolveLostItemReport(reportId) {
  return resolveLost(supabase, reportId)
}

export function unreadCountForTrip(tripId, userId) {
  return unreadForTrip(supabase, tripId, userId)
}

export function notifyTripMessage(input) {
  return notifyMessage(supabase, input)
}

export function notifyLostItemReport(input) {
  return notifyLost(supabase, input)
}

export function subscribeLostItemReports(onChange) {
  return subscribeLost(supabase, onChange)
}
