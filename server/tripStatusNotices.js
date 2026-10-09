/**
 * Trip status-change pushes, drained from the trip_status_notices outbox.
 * The trips trigger enqueues rows and pokes /api/driver?action=trip-sweeps&only=trip-status-notices;
 * the minute cron drains anything left. Each row is claimed once, re-checked
 * against the live trip (a stale "arriving" never lands after "arrived"), then sent.
 * Push failures are recorded on the row and never fail the sweep.
 */
import { sendExpoPush } from './expoPush.js'
import { GRACE_MS } from '../src/lib/waitFee.js'

export const NOTICE_MAX_AGE_MS = 15 * 60 * 1000
export const NOTICE_CLAIM_STALE_MS = 2 * 60 * 1000
export const NOTICE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
/** Driver builds that handle trip-status pushes register this feature on driver_push_tokens. */
export const DRIVER_STATUS_PUSH_FEATURE = 'trip_status_v1'
export const RIDER_PUSH_CHANNEL = 'trip-status'
export const DRIVER_PUSH_CHANNEL = 'ride-requests'

export const NOTICE_KINDS = Object.freeze({
  driver_en_route: Object.freeze({ role: 'rider', statuses: Object.freeze(['accepted', 'arriving']) }),
  driver_arriving: Object.freeze({ role: 'rider', statuses: Object.freeze(['arriving']) }),
  driver_arrived: Object.freeze({ role: 'rider', statuses: Object.freeze(['arrived']) }),
  arrive_prompt: Object.freeze({ role: 'driver', statuses: Object.freeze(['arriving']) }),
})

function clean(value, max = 80) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function noticeFirstName(fullName, fallback = 'Your driver') {
  const first = clean(fullName).split(' ')[0]
  return first || fallback
}

export function vehicleLine(vehicle) {
  if (!vehicle || typeof vehicle !== 'object') return ''
  const car = [vehicle.color, vehicle.make, vehicle.model].map((part) => clean(part, 24)).filter(Boolean).join(' ')
  const plate = clean(vehicle.plate, 12).toUpperCase()
  return [car, plate].filter(Boolean).join(' · ')
}

const graceMinutes = Math.round(GRACE_MS / 60000)

/** Push copy for one notice. Null for an unknown kind. */
export function tripStatusNoticeCopy(kind, { driverName = '', pickupLabel = '', vehicle = '' } = {}) {
  const who = noticeFirstName(driverName)
  const pickup = clean(pickupLabel) || 'your pickup'
  switch (kind) {
    case 'driver_en_route':
      return {
        title: `${who} is on the way`,
        body: vehicle ? `${vehicle}. Heading to ${pickup}.` : `Heading to ${pickup}. Track the car in Clemson RIDES.`,
      }
    case 'driver_arriving':
      return { title: `${who} is about 1 min away`, body: `Head to ${pickup} so you are ready.` }
    case 'driver_arrived':
      return {
        title: `${who} is here`,
        body: `${vehicle ? `${vehicle} at ${pickup}. ` : `Meet them at ${pickup}. `}Waiting is free for ${graceMinutes} minutes, then $1 a minute.`,
      }
    case 'arrive_prompt':
      return { title: 'Arrived at pickup?', body: `You are near ${pickup}. Tap to confirm you have arrived.` }
    default:
      return null
  }
}

export function noticeIsCurrent(notice, trip) {
  const spec = NOTICE_KINDS[notice?.kind]
  if (!spec || !trip) return false
  if (notice.driver_id && trip.driver_id !== notice.driver_id) return false
  if (spec.role === 'rider' && trip.rider_id !== notice.recipient_id) return false
  if (spec.role === 'driver' && trip.driver_id !== notice.recipient_id) return false
  return spec.statuses.includes(String(trip.status))
}

async function maybeSingle(query) {
  try {
    const result = await query
    return result?.error ? null : result?.data || null
  } catch {
    return null
  }
}

export async function readRiderPushToken(sb, riderId) {
  if (!riderId) return null
  const row = await maybeSingle(sb.from('rider_push_tokens').select('token').eq('rider_id', riderId).maybeSingle())
  return clean(row?.token, 200) || null
}

/** Only builds that registered DRIVER_STATUS_PUSH_FEATURE get status pushes. Older builds keep offer pushes only. */
export async function readDriverStatusPushToken(sb, driverId) {
  if (!driverId) return null
  const row = await maybeSingle(sb.from('driver_push_tokens').select('token, features').eq('driver_id', driverId).maybeSingle())
  const features = Array.isArray(row?.features) ? row.features : []
  if (!features.includes(DRIVER_STATUS_PUSH_FEATURE)) return null
  return clean(row?.token, 200) || null
}

async function noticeContext(sb, trip) {
  const profile = await maybeSingle(sb.from('profiles').select('full_name').eq('id', trip.driver_id).maybeSingle())
  let vehicle = null
  try {
    const result = await sb.from('vehicles').select('color, make, model, plate').eq('driver_id', trip.driver_id).limit(1)
    vehicle = result?.error ? null : result?.data?.[0] || null
  } catch { vehicle = null }
  return { driverName: profile?.full_name || '', pickupLabel: trip.pickup_label || '', vehicle: vehicleLine(vehicle) }
}

async function finish(sb, id, result, nowIso) {
  await sb.from('trip_status_notices').update({ sent_at: nowIso, result: clean(result, 60) || 'done' }).eq('id', id)
}

export async function sweepTripStatusNotices(sb, { now = new Date(), dryRun = false, sendPush = sendExpoPush } = {}) {
  const nowMs = new Date(now).getTime()
  const nowIso = new Date(nowMs).toISOString()
  const since = new Date(nowMs - NOTICE_MAX_AGE_MS).toISOString()
  const { data, error } = await sb.from('trip_status_notices')
    .select('id, trip_id, kind, recipient_id, recipient_role, driver_id, created_at, claimed_at, attempts')
    .is('sent_at', null)
    .gte('created_at', since)
    .order('id', { ascending: true })
    .limit(50)
  // Before the outbox migration is applied the sweep is a no-op, not a cron failure.
  if (error && (['42P01', 'PGRST205'].includes(error.code) || /trip_status_notices/.test(error.message || ''))) {
    return { sent: 0, skipped: 0, unavailable: true, ids: { sent: [], skipped: [] } }
  }
  if (error) throw new Error(error.message || 'Could not load trip status notices')
  const result = { sent: 0, skipped: 0, ids: { sent: [], skipped: [] } }
  const skip = (id) => { result.skipped += 1; result.ids.skipped.push(id) }
  for (const row of data || []) {
    const claimedMs = row.claimed_at ? Date.parse(row.claimed_at) : null
    if (claimedMs != null && nowMs - claimedMs < NOTICE_CLAIM_STALE_MS) continue
    if (dryRun) { skip(row.id); continue }
    try {
      let claim = sb.from('trip_status_notices')
        .update({ claimed_at: nowIso, attempts: (Number(row.attempts) || 0) + 1 })
        .eq('id', row.id)
        .is('sent_at', null)
      claim = row.claimed_at ? claim.eq('claimed_at', row.claimed_at) : claim.is('claimed_at', null)
      const claimed = await claim.select('id')
      if (claimed.error || !claimed.data?.length) continue
      const trip = await maybeSingle(sb.from('trips').select('id, status, rider_id, driver_id, pickup_label').eq('id', row.trip_id).maybeSingle())
      if (!noticeIsCurrent(row, trip)) { await finish(sb, row.id, 'stale', nowIso); skip(row.id); continue }
      const copy = tripStatusNoticeCopy(row.kind, await noticeContext(sb, trip))
      const rider = row.recipient_role === 'rider'
      const token = rider ? await readRiderPushToken(sb, row.recipient_id) : await readDriverStatusPushToken(sb, row.recipient_id)
      if (!copy || !token) { await finish(sb, row.id, copy ? 'no_token' : 'unknown_kind', nowIso); skip(row.id); continue }
      const push = await sendPush({
        to: token,
        title: copy.title,
        body: copy.body,
        data: { tripId: trip.id, kind: row.kind, status: trip.status },
        channelId: rider ? RIDER_PUSH_CHANNEL : DRIVER_PUSH_CHANNEL,
      })
      await finish(sb, row.id, push?.sent ? 'sent' : (push?.reason || 'not_sent'), nowIso)
      if (push?.sent) { result.sent += 1; result.ids.sent.push(row.id) } else skip(row.id)
    } catch (err) {
      console.error('[trip-status-notices]', row.id, err?.message || err)
      skip(row.id)
    }
  }
  if (!dryRun) {
    try {
      await sb.from('trip_status_notices').delete().lt('created_at', new Date(nowMs - NOTICE_RETENTION_MS).toISOString())
    } catch { /* retention is best-effort */ }
  }
  return result
}
