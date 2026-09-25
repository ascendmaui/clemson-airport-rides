import { claimChoices, friendlyLostFoundError } from '../../src/lib/lostFoundFlow.js'

export { resolutionLabel, statusLabel } from '../../src/lib/lostFoundFlow.js'
import {
  coarsePlaceLabel,
  firstNameOnly,
  hasRideChat,
  toPublicReport,
  toPublicTrip,
} from '../../src/lib/lostFoundPrivacy.js'

const REPORT_COLS =
  'id, trip_id, reporter_id, counterpart_id, item_description, status, resolution, support_note, created_at, updated_at, claimed_at, returned_at, closed_at'

function requireClient(supabase) {
  if (!supabase) throw new Error('Supabase is not configured')
}

async function firstNamesById(supabase, ids) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!supabase || unique.length === 0) return {}
  const { data, error } = await supabase.from('profiles').select('id, full_name').in('id', unique)
  if (error) throw new Error(friendlyLostFoundError(error.message))
  const out = {}
  for (const row of data || []) out[row.id] = firstNameOnly(row.full_name)
  return out
}

async function placeHintsForTrips(supabase, tripIds) {
  const unique = [...new Set(tripIds.filter(Boolean))]
  if (!supabase || unique.length === 0) return {}
  const { data, error } = await supabase
    .from('trips')
    .select('id, pickup_label, dropoff_label, completed_at, requested_at, metadata')
    .in('id', unique)
  if (error) throw new Error(friendlyLostFoundError(error.message))
  const out = {}
  for (const trip of data || []) {
    out[trip.id] = {
      pickup: coarsePlaceLabel(trip.pickup_label, 'Pickup area'),
      dropoff: coarsePlaceLabel(trip.dropoff_label, 'Dropoff area'),
      completedAt: trip.completed_at || trip.requested_at || null,
      hasRideChat: hasRideChat(trip.metadata),
    }
  }
  return out
}

function shapeReport(row, userId, names, places) {
  const place = places[row.trip_id] || {}
  return toPublicReport(row, userId, {
    reporterFirstName: names[row.reporter_id] || 'Rider',
    counterpartFirstName: names[row.counterpart_id] || 'Driver',
    pickup: place.pickup,
    dropoff: place.dropoff,
    completedAt: place.completedAt,
    hasRideChat: place.hasRideChat,
  })
}

export async function fetchRecentLostFoundTrips(supabase, userId) {
  requireClient(supabase)
  if (!userId) return []
  const { data, error } = await supabase
    .from('trips')
    .select('id, rider_id, driver_id, pickup_label, dropoff_label, completed_at, requested_at, status')
    .eq('status', 'completed')
    .or(`rider_id.eq.${userId},driver_id.eq.${userId}`)
    .not('driver_id', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(15)
  if (error) throw new Error(friendlyLostFoundError(error.message))
  const otherIds = (data || []).map((trip) => (trip.rider_id === userId ? trip.driver_id : trip.rider_id))
  const names = await firstNamesById(supabase, otherIds)
  return (data || []).map((trip) => toPublicTrip(trip, userId, names)).filter((trip) => trip?.otherId)
}

export async function listLostFoundReports(supabase, userId) {
  requireClient(supabase)
  if (!userId) return []
  const { data: me } = await supabase
    .from('profiles')
    .select('is_admin, role')
    .eq('id', userId)
    .maybeSingle()
  const admin = Boolean(me?.is_admin) || me?.role === 'admin' || me?.role === 'ops'
  let query = supabase.from('lost_found_reports').select(REPORT_COLS).order('created_at', { ascending: false }).limit(50)
  if (!admin) query = query.or(`reporter_id.eq.${userId},counterpart_id.eq.${userId}`)
  const { data, error } = await query
  if (error) throw new Error(friendlyLostFoundError(error.message))
  const rows = data || []
  const names = await firstNamesById(supabase, rows.flatMap((row) => [row.reporter_id, row.counterpart_id]))
  const places = await placeHintsForTrips(supabase, rows.map((row) => row.trip_id))
  return rows.map((row) => shapeReport(row, userId, names, places))
}

export async function fetchLostFoundReport(supabase, reportId, userId) {
  requireClient(supabase)
  const { data, error } = await supabase
    .from('lost_found_reports')
    .select(REPORT_COLS)
    .eq('id', reportId)
    .maybeSingle()
  if (error) throw new Error(friendlyLostFoundError(error.message))
  if (!data) return null
  const names = await firstNamesById(supabase, [data.reporter_id, data.counterpart_id])
  const places = await placeHintsForTrips(supabase, [data.trip_id])
  const report = shapeReport(data, userId, names, places)
  const { data: messages, error: msgErr } = await supabase
    .from('lost_found_messages')
    .select('id, sender_id, body, created_at')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true })
  if (msgErr) throw new Error(friendlyLostFoundError(msgErr.message))
  report.messages = (messages || []).map((message) => ({
    id: message.id,
    body: message.body,
    createdAt: message.created_at,
    mine: message.sender_id === userId,
    senderFirstName: message.sender_id === userId ? 'You' : (names[message.sender_id] || 'Them'),
  }))
  report.choices = claimChoices(report, userId)
  return report
}

export async function createLostFoundReport(supabase, { tripId, reporterId, counterpartId, description }) {
  requireClient(supabase)
  const item = String(description || '').trim()
  if (item.length < 2) throw new Error('Describe the item in a few words.')
  if (item.length > 400) throw new Error('Keep the description under 400 characters.')
  const { data, error } = await supabase
    .from('lost_found_reports')
    .insert({
      trip_id: tripId,
      reporter_id: reporterId,
      counterpart_id: counterpartId,
      item_description: item,
      status: 'open',
    })
    .select('id')
    .single()
  if (error) throw new Error(friendlyLostFoundError(error.message))
  const { error: eventErr } = await supabase.from('trip_events').insert({
    trip_id: tripId,
    kind: 'lost_found_reported',
    payload: { report_id: data.id },
  })
  if (eventErr) console.warn('[lost-found] notify event', eventErr.message)
  return data
}

async function updateReport(supabase, id, patch) {
  requireClient(supabase)
  const { error } = await supabase.from('lost_found_reports').update(patch).eq('id', id)
  if (error) throw new Error(friendlyLostFoundError(error.message))
}

export async function confirmFound(supabase, reportId) {
  await updateReport(supabase, reportId, { status: 'claimed', resolution: 'found' })
}

export async function confirmNotFound(supabase, reportId) {
  await updateReport(supabase, reportId, { status: 'closed', resolution: 'not_found' })
}

export async function markReturned(supabase, reportId) {
  await updateReport(supabase, reportId, { status: 'returned' })
}

export async function closeLostFoundReport(supabase, reportId) {
  await updateReport(supabase, reportId, { status: 'closed' })
}

export async function saveSupportNote(supabase, reportId, note) {
  const text = String(note || '').trim()
  if (text.length > 1000) throw new Error('Keep the support note under 1000 characters.')
  await updateReport(supabase, reportId, { support_note: text || null })
}

export async function sendLostFoundMessage(supabase, { reportId, senderId, body }) {
  requireClient(supabase)
  const text = String(body || '').trim()
  if (!text) throw new Error('Write a short message about the return.')
  if (text.length > 1000) throw new Error('Keep the message under 1000 characters.')
  const { error } = await supabase.from('lost_found_messages').insert({
    report_id: reportId,
    sender_id: senderId,
    body: text,
  })
  if (error) throw new Error(friendlyLostFoundError(error.message))
}
