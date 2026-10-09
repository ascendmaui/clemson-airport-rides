/**
 * Best-effort push and email when a trip message or lost-item thread opens.
 * The message row itself is written by the client under RLS. This module only notifies.
 */
import { sendExpoPush } from './expoPush.js'
import { sendApplicantNotice } from './applicantMail.js'
import { lostItemNoticeBody } from '../shared/copy/messaging.js'
import { LOST_ITEM_THREAD_WINDOW_MS } from '../src/lib/tripChatRules.js'

const WINDOW_DAYS = LOST_ITEM_THREAD_WINDOW_MS / (24 * 60 * 60 * 1000)

function clean(value, max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function counterpartId(trip, actorId) {
  if (!trip || !actorId) return null
  if (actorId === trip.rider_id) return trip.driver_id || null
  if (actorId === trip.driver_id) return trip.rider_id || null
  return null
}

export function messageNoticeCopy(body) {
  const preview = clean(body, 140)
  return {
    title: 'New ride message',
    body: preview || 'Open Clemson RIDES to read it.',
    email: false,
  }
}

export function lostItemNoticeCopy(description, reporterRole) {
  const item = clean(description, 80)
  return {
    title: 'Lost item on your ride',
    body: lostItemNoticeBody({ description: item, reporterRole, days: WINDOW_DAYS }),
    email: true,
    subject: 'A lost item was reported on your Clemson RIDES trip',
  }
}

async function firstToken(sb, table, column, idColumn, userId) {
  if (!sb?.from) return null
  const result = await sb.from(table).select(column).eq(idColumn, userId).maybeSingle()
  if (result?.error) return null
  const token = clean(result?.data?.[column], 200)
  return token || null
}

export async function pushTokenForUser(sb, userId) {
  if (!userId) return null
  const driverStatus = await firstToken(sb, 'driver_status', 'expo_push_token', 'driver_id', userId)
  if (driverStatus) return driverStatus
  const driverTable = await firstToken(sb, 'driver_push_tokens', 'token', 'driver_id', userId)
  if (driverTable) return driverTable
  return firstToken(sb, 'rider_push_tokens', 'token', 'rider_id', userId)
}

async function emailForUser(sb, userId) {
  if (!sb?.from || !userId) return null
  const profile = await sb.from('profiles').select('email').eq('id', userId).maybeSingle()
  const direct = clean(profile?.data?.email, 200)
  if (direct) return direct
  if (typeof sb.auth?.admin?.getUserById !== 'function') return null
  const authUser = await sb.auth.admin.getUserById(userId)
  return clean(authUser?.data?.user?.email, 200) || null
}

/**
 * @param {object} input
 * @param {import('@supabase/supabase-js').SupabaseClient} input.sb
 * @param {string} input.actorId
 * @param {string} input.tripId
 * @param {'message' | 'lost-item'} input.kind
 * @param {string} [input.messageId]
 * @param {string} [input.reportId]
 */
export async function notifyTripCounterpart(input, deps = {}) {
  const sb = input?.sb
  const actorId = input?.actorId
  const tripId = input?.tripId
  const kind = input?.kind
  if (!sb) return { ok: false, reason: 'supabase_missing' }
  if (!actorId || !tripId) return { ok: false, reason: 'missing_trip' }
  if (kind !== 'message' && kind !== 'lost-item') return { ok: false, reason: 'unknown_kind' }

  const tripRes = await sb.from('trips').select('id, rider_id, driver_id, status').eq('id', tripId).maybeSingle()
  if (tripRes.error) return { ok: false, reason: 'trip_lookup_failed' }
  const trip = tripRes.data
  const recipientId = counterpartId(trip, actorId)
  if (!recipientId) return { ok: false, reason: 'not_a_party' }

  let copy
  if (kind === 'message') {
    if (!input.messageId) return { ok: false, reason: 'missing_message' }
    const messageRes = await sb
      .from('trip_messages')
      .select('id, sender_id, body, trip_id')
      .eq('id', input.messageId)
      .maybeSingle()
    const message = messageRes.data
    if (messageRes.error || !message || message.trip_id !== tripId || message.sender_id !== actorId) {
      return { ok: false, reason: 'message_not_found' }
    }
    copy = messageNoticeCopy(message.body)
  } else {
    if (!input.reportId) return { ok: false, reason: 'missing_report' }
    const reportRes = await sb
      .from('trip_lost_item_reports')
      .select('id, trip_id, reporter_id, reporter_role, description, status')
      .eq('id', input.reportId)
      .maybeSingle()
    const report = reportRes.data
    if (reportRes.error || !report || report.trip_id !== tripId || report.reporter_id !== actorId || report.status !== 'open') {
      return { ok: false, reason: 'report_not_found' }
    }
    copy = lostItemNoticeCopy(report.description, report.reporter_role)
  }

  const sendPush = deps.sendPush || sendExpoPush
  const sendEmail = deps.sendEmail || ((payload) => sendApplicantNotice(payload))
  const token = await pushTokenForUser(sb, recipientId)
  const push = await sendPush({
    to: token,
    title: copy.title,
    body: copy.body,
    data: { tripId, kind: kind === 'lost-item' ? 'trip_lost_item' : 'trip_message' },
    channelId: 'ride-requests',
  })

  let email = { emailed: false, reason: 'not_requested' }
  if (copy.email) {
    const to = await emailForUser(sb, recipientId)
    email = await sendEmail({ to, subject: copy.subject, text: copy.body })
  }

  return {
    ok: true,
    recipientId,
    push: { sent: Boolean(push?.sent), reason: push?.reason || null },
    email: { emailed: Boolean(email?.emailed), reason: email?.reason || email?.todo || null },
  }
}
