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
  // Released kinds: the recipient no longer shares this driver, so the usual driver match is skipped.
  rider_canceled: Object.freeze({ role: 'driver', statuses: Object.freeze(['canceled']), released: 'any' }),
  rider_ended_early: Object.freeze({ role: 'driver', statuses: Object.freeze(['canceled_midride']) }),
  rider_no_show: Object.freeze({ role: 'driver', statuses: Object.freeze(['cancelled_wait']) }),
  driver_canceled: Object.freeze({ role: 'rider', statuses: Object.freeze([]), released: 'live' }),
  wait_canceled: Object.freeze({ role: 'rider', statuses: Object.freeze(['cancelled_wait']) }),
})

const LIVE_STATUSES = Object.freeze(['searching', 'offered', 'scheduled', 'accepted', 'arriving', 'arrived'])

function money(cents) {
  const n = Math.max(0, Math.round(Number(cents) || 0))
  return `$${(n / 100).toFixed(2)}`
}

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
export function tripStatusNoticeCopy(kind, {
  driverName = '',
  riderName = '',
  pickupLabel = '',
  vehicle = '',
  switched = false,
  riderFeeCents = 0,
  driverWaitCents = 0,
} = {}) {
  const who = noticeFirstName(driverName)
  const rider = noticeFirstName(riderName, 'The rider')
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
    case 'rider_canceled':
      return {
        title: 'Ride canceled',
        body: switched
          ? `${rider} changed their ride. You're free for the next offer.`
          : `${rider} canceled this ride. You're free for the next offer.`,
      }
    case 'rider_ended_early':
      return { title: 'Trip ended early', body: `${rider} ended the trip early. Open the trip to see your pay.` }
    case 'rider_no_show':
      return {
        title: 'Rider no-show',
        body: Number(driverWaitCents) > 0
          ? `The ride was canceled after the wait. You earn ${money(driverWaitCents)}.`
          : 'The ride was canceled after the wait.',
      }
    case 'driver_canceled':
      return { title: 'Your driver canceled', body: `We're finding you another driver for ${pickup}.` }
    case 'wait_canceled':
      return {
        title: 'Ride canceled',
        body: Number(riderFeeCents) > 0
          ? `Your driver waited at ${pickup}. A ${money(riderFeeCents)} no-show fee applies.`
          : `Your driver waited at ${pickup} and the ride was canceled.`,
      }
    default:
      return null
  }
}

export function noticeIsCurrent(notice, trip) {
  const spec = NOTICE_KINDS[notice?.kind]
  if (!spec || !trip) return false
  const status = String(trip.status)
  if (spec.role === 'rider' && trip.rider_id !== notice.recipient_id) return false
  if (spec.released) {
    // Sent to the side that lost the other party: current once the trip has moved off that driver.
    if (spec.role === 'driver' && notice.recipient_id !== notice.driver_id) return false
    if (spec.statuses.includes(status)) return true
    const movedOn = Boolean(notice.driver_id) && trip.driver_id !== notice.driver_id
    return spec.released === 'live' ? movedOn && LIVE_STATUSES.includes(status) : movedOn
  }
  if (notice.driver_id && trip.driver_id !== notice.driver_id) return false
  if (spec.role === 'driver' && trip.driver_id !== notice.recipient_id) return false
  return spec.statuses.includes(status)
}

async function maybeSingle(query) {
  try {
    const result = await query
    return result?.error ? null : result?.data || null
  } catch {
    return null
  }
}

/** Riders who turned off "Ride updates" in Notifications get no status pushes. */
export async function riderWantsRideUpdates(sb, riderId) {
  const profile = await maybeSingle(sb.from('profiles').select('notification_prefs').eq('id', riderId).maybeSingle())
  return profile?.notification_prefs?.ride !== false
}

export async function readRiderPushToken(sb, riderId) {
  if (!riderId) return null
  if (!await riderWantsRideUpdates(sb, riderId)) return null
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

async function noticeContext(sb, trip, notice) {
  const driverId = notice?.driver_id || trip.driver_id
  const meta = trip.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
  const driverSide = NOTICE_KINDS[notice?.kind]?.role === 'driver'
  let riderName = ''
  if (driverSide) {
    riderName = clean(meta.rider_first_name)
    if (!riderName && trip.rider_id) {
      const rider = await maybeSingle(sb.from('profiles').select('full_name').eq('id', trip.rider_id).maybeSingle())
      riderName = rider?.full_name || ''
    }
  }
  const base = {
    riderName,
    pickupLabel: trip.pickup_label || '',
    switched: Boolean(meta.rider_switch),
    riderFeeCents: (Number(trip.wait_fee_cents) || 0) + (Number(trip.cancel_fee_cents) || 0),
    driverWaitCents: Number(trip.driver_wait_earnings_cents) || 0,
  }
  if (driverSide || !driverId) return { ...base, driverName: '', vehicle: '' }
  const profile = await maybeSingle(sb.from('profiles').select('full_name').eq('id', driverId).maybeSingle())
  let vehicle = null
  try {
    const result = await sb.from('vehicles').select('color, make, model, plate').eq('driver_id', driverId).limit(1)
    vehicle = result?.error ? null : result?.data?.[0] || null
  } catch { vehicle = null }
  return { ...base, driverName: profile?.full_name || '', vehicle: vehicleLine(vehicle) }
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
      const trip = await maybeSingle(sb.from('trips')
        .select('id, status, rider_id, driver_id, pickup_label, metadata, wait_fee_cents, cancel_fee_cents, driver_wait_earnings_cents')
        .eq('id', row.trip_id).maybeSingle())
      if (!noticeIsCurrent(row, trip)) { await finish(sb, row.id, 'stale', nowIso); skip(row.id); continue }
      const copy = tripStatusNoticeCopy(row.kind, await noticeContext(sb, trip, row))
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
