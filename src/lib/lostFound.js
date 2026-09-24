import { supabase } from './supabase'
import {
  closeLostFoundReport as closeReport,
  confirmFound as confirmFoundReport,
  confirmNotFound as confirmNotFoundReport,
  createLostFoundReport as createReport,
  fetchLostFoundReport as fetchReport,
  fetchRecentLostFoundTrips as fetchTrips,
  listLostFoundReports as listReports,
  markReturned as markReportReturned,
  saveSupportNote as saveNote,
  sendLostFoundMessage as sendMessage,
} from '../../packages/rides-native/lostFoundClient.js'

export function fetchRecentLostFoundTrips(userId) {
  return fetchTrips(supabase, userId)
}

export function listLostFoundReports(userId) {
  return listReports(supabase, userId)
}

export function fetchLostFoundReport(reportId, userId) {
  return fetchReport(supabase, reportId, userId)
}

export function createLostFoundReport(input) {
  return createReport(supabase, input)
}

export function confirmFound(reportId) {
  return confirmFoundReport(supabase, reportId)
}

export function confirmNotFound(reportId) {
  return confirmNotFoundReport(supabase, reportId)
}

export function markReturned(reportId) {
  return markReportReturned(supabase, reportId)
}

export function closeLostFoundReport(reportId) {
  return closeReport(supabase, reportId)
}

export function saveSupportNote(reportId, note) {
  return saveNote(supabase, reportId, note)
}

export function sendLostFoundMessage(input) {
  return sendMessage(supabase, input)
}
