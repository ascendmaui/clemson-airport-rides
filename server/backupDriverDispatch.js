/**
 * Server enforcement for the scheduled backup-driver queue.
 * Writes stay on trips.metadata.backup_queue so staging can run this before
 * the backup-queue migration is applied. Column and strike-table writes are
 * best-effort and ignored when those relations are absent.
 */
import { unchangedOfferQuery } from '../shared/driverOrder.js'
import { insertTripEvent } from './tripEvents.js'
import { sendExpoPush } from './expoPush.js'
import {
  acceptBackupRole,
  backupNumberTwoCopy,
  confirmWindowBounds,
  CONFIRM_TRIP_COPY,
  driverStartedTowardPickup,
  estimateDriveMs,
  handToUrgentPool,
  isBackupQueueRide,
  promoteBackup,
  readBackupQueue,
  releaseBackupSeat,
  RIDER_ENROUTE_COPY,
  URGENT_POOL_LABEL,
} from '../shared/backupDriverQueue.js'

const ACTIVE_STATUSES = ['scheduled', 'accepted', 'arriving']

function queueOf(trip) {
  return readBackupQueue(trip)
}

async function loadTrip(sb, tripId) {
  const row = await sb.from('trips').select('*').eq('id', tripId).maybeSingle()
  if (row.error) throw new Error(row.error.message)
  return row.data
}

async function commitQueue(sb, trip, queue, patch = {}, metadataPatch = {}) {
  const metadata = { ...(trip.metadata || {}), ...metadataPatch, backup_queue: queue }
  const updated = await unchangedOfferQuery(
    sb.from('trips').update({ metadata, ...patch }),
    trip,
  ).eq('id', trip.id).select('id, status, driver_id, metadata').maybeSingle()
  if (updated.error) throw new Error(updated.error.message)
  return updated.data || null
}

async function audit(sb, tripId, kind, payload) {
  try {
    await insertTripEvent(sb, { trip_id: tripId, kind, payload })
  } catch (error) {
    console.error('[backup-queue] event', kind, error?.message || error)
  }
}

async function recordStrike(sb, { driverId, tripId, reason, at }) {
  if (!driverId) return
  try {
    const inserted = await sb.from('driver_reliability_strikes').insert({
      driver_id: driverId,
      trip_id: tripId,
      reason,
      created_at: at,
    })
    if (inserted?.error && !/relation|does not exist|schema cache/i.test(inserted.error.message || '')) {
      console.error('[backup-queue] strike', inserted.error.message)
    }
  } catch (error) {
    const message = error?.message || String(error)
    if (!/relation|does not exist|schema cache/i.test(message)) {
      console.error('[backup-queue] strike', message)
    }
  }
}

async function pushToDriver(sb, driverId, { title, body, tripId, kind }) {
  if (!driverId) return { sent: false, reason: 'no_driver' }
  let token = null
  try {
    const status = await sb.from('driver_status').select('expo_push_token').eq('driver_id', driverId).maybeSingle()
    token = status.data?.expo_push_token || null
  } catch {
    token = null
  }
  if (!token) return { sent: false, reason: 'push_token_missing' }
  return sendExpoPush({
    to: token,
    title,
    body,
    data: { tripId, kind },
    channelId: 'ride-requests',
  })
}

async function pushToRider(sb, riderId, { title, body, tripId }) {
  if (!riderId) return { sent: false, reason: 'no_rider' }
  let token = null
  try {
    const profile = await sb.from('profiles').select('expo_push_token').eq('id', riderId).maybeSingle()
    token = profile.data?.expo_push_token || null
  } catch {
    token = null
  }
  if (!token) return { sent: false, reason: 'push_token_missing' }
  return sendExpoPush({
    to: token,
    title,
    body,
    data: { tripId, kind: 'driver_enroute' },
    channelId: 'trip-updates',
  })
}

async function notifyAdmin(sb, { tripId, title, body }) {
  try {
    const inserted = await sb.from('admin_notifications').insert({
      kind: 'backup_queue',
      title,
      body,
      trip_id: tripId,
      created_at: new Date().toISOString(),
    })
    if (inserted?.error && !/relation|does not exist|schema cache/i.test(inserted.error.message || '')) {
      console.error('[backup-queue] admin', inserted.error.message)
    }
  } catch (error) {
    const message = error?.message || String(error)
    if (!/relation|does not exist|schema cache/i.test(message)) {
      console.error('[backup-queue] admin', message)
    }
  }
}

export async function publicDriverCard(sb, driverId) {
  const card = {
    id: driverId,
    name: 'Driver',
    avatarUrl: null,
    vehicleLabel: 'Vehicle',
    ratingAvg: null,
    ratingCount: 0,
  }
  if (!sb || !driverId) return card
  try {
    const profile = await sb.from('profiles').select('id, full_name, avatar_url, rating_avg, rating_count').eq('id', driverId).maybeSingle()
    const row = profile.data
    if (row) {
      card.name = row.full_name || card.name
      card.avatarUrl = row.avatar_url || null
      card.ratingAvg = row.rating_avg != null ? Number(row.rating_avg) : null
      card.ratingCount = Math.max(0, Math.round(Number(row.rating_count) || 0))
    }
  } catch {
    /* Profile columns vary. The seat still fills. */
  }
  try {
    const vehicle = await sb.from('vehicles').select('color, make, model').eq('driver_id', driverId).limit(1)
    const row = Array.isArray(vehicle.data) ? vehicle.data[0] : vehicle.data
    const label = [row?.color, row?.make, row?.model].filter(Boolean).join(' ')
    if (label) card.vehicleLabel = label
  } catch {
    /* Vehicle is optional on the rider card. */
  }
  return card
}

function pickupPoint(trip) {
  const lat = Number(trip?.pickup_lat)
  const lng = Number(trip?.pickup_lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

async function driverFix(sb, driverId) {
  if (!driverId) return null
  try {
    const status = await sb.from('driver_status').select('lat, lng, online, updated_at').eq('driver_id', driverId).maybeSingle()
    const row = status.data
    if (!row || !Number.isFinite(Number(row.lat)) || !Number.isFinite(Number(row.lng))) {
      return { online: row?.online !== false, fix: null }
    }
    return {
      online: row.online !== false,
      fix: { lat: Number(row.lat), lng: Number(row.lng), at: row.updated_at || null },
    }
  } catch {
    return { online: true, fix: null }
  }
}

async function tripFix(sb, tripId, driverId) {
  try {
    const row = await sb.from('trip_driver_locations').select('lat, lng, driver_id, updated_at').eq('trip_id', tripId).maybeSingle()
    const data = row.data
    if (!data || (driverId && data.driver_id && data.driver_id !== driverId)) return null
    if (!Number.isFinite(Number(data.lat)) || !Number.isFinite(Number(data.lng))) return null
    return { lat: Number(data.lat), lng: Number(data.lng), at: data.updated_at || null }
  } catch {
    return null
  }
}

export async function acceptBackupSlot(sb, { tripId, driverId, now = new Date() } = {}) {
  const trip = await loadTrip(sb, tripId)
  if (!trip) return { ok: false, status: 404, error: 'Scheduled ride is no longer available' }
  if (!isBackupQueueRide(trip)) return { ok: true, useScheduledRpc: true }
  if (trip.status !== 'scheduled') return { ok: false, status: 409, error: 'Scheduled ride is no longer available' }
  if (trip.rider_id && trip.rider_id === driverId) {
    return { ok: false, status: 403, error: 'You can\'t accept your own ride' }
  }
  const decision = acceptBackupRole(queueOf(trip), driverId)
  if (!decision.ok) {
    const message = decision.code === 'queue_full'
      ? 'This ride already has a driver and a backup.'
      : 'Scheduled ride is no longer available'
    return { ok: false, status: 409, error: message, code: decision.code }
  }
  if (decision.idempotent) {
    return { ok: true, role: decision.role, idempotent: true, tripId }
  }
  const card = await publicDriverCard(sb, driverId)
  const stamped = {
    ...decision.queue,
    ...(decision.role === 'primary' ? { primaryCard: card } : { backupCard: card }),
    events: decision.queue.events.map((event, index, all) => (
      index === all.length - 1 ? { ...event, at: now.toISOString() } : event
    )),
  }
  const saved = await commitQueue(sb, trip, stamped)
  if (!saved) return { ok: false, status: 409, error: 'Scheduled ride is no longer available', raced: true }
  await audit(sb, trip.id, decision.role === 'primary' ? 'backup_primary_accepted' : 'backup_driver_accepted', {
    driverId,
    bonusCents: stamped.bonusCents,
    lookingForBackup: !stamped.backupDriverId,
  })
  if (decision.role === 'backup') {
    await pushToDriver(sb, driverId, {
      tripId: trip.id,
      kind: 'backup_seat',
      title: 'You\'re the backup',
      body: backupNumberTwoCopy(trip.pickup_label),
    })
  }
  return {
    ok: true,
    role: decision.role,
    tripId: trip.id,
    lookingForBackup: !stamped.backupDriverId,
    status: trip.status,
  }
}

export async function confirmBackupTrip(sb, { tripId, driverId, navigate = false, now = new Date() } = {}) {
  const trip = await loadTrip(sb, tripId)
  if (!trip) return { ok: false, status: 404, error: 'Trip not found' }
  const queue = queueOf(trip)
  if (!queue) return { ok: false, status: 409, error: 'This ride has no backup confirm window' }
  if (queue.primaryDriverId !== driverId) {
    return { ok: false, status: 403, error: 'Only the assigned driver can confirm this trip' }
  }
  if (queue.confirmState === 'enroute') return { ok: true, idempotent: true, enroute: true }
  const at = now.toISOString()
  const next = {
    ...queue,
    confirmedAt: queue.confirmedAt || at,
    navigateStartedAt: navigate ? (queue.navigateStartedAt || at) : queue.navigateStartedAt,
    generation: queue.generation + 1,
    events: [...queue.events, { kind: navigate ? 'navigate' : 'confirmed', at, driverId }].slice(-12),
  }
  const saved = await commitQueue(sb, trip, next)
  if (!saved) return { ok: false, status: 409, error: 'This trip changed. Refresh and try again.', raced: true }
  await audit(sb, trip.id, navigate ? 'backup_navigate' : 'backup_confirmed', { driverId, at })
  return { ok: true, confirmedAt: next.confirmedAt, navigateStartedAt: next.navigateStartedAt }
}

export async function cancelBackupPrimary(sb, { tripId, driverId, now = new Date() } = {}) {
  const trip = await loadTrip(sb, tripId)
  if (!trip) return { ok: false, status: 404, error: 'Trip not found' }
  const queue = queueOf(trip)
  if (!queue) return { ok: false, status: 409, error: 'This ride has no backup driver' }
  if (queue.primaryDriverId !== driverId) {
    return { ok: false, status: 403, error: 'Only the assigned driver can release this seat' }
  }
  const at = now.toISOString()
  const outcome = queue.backupDriverId
    ? { action: 'promote', queue: promoteBackup(queue, { reason: 'early_cancel', now: at }) }
    : { action: 'pool', queue: handToUrgentPool(queue, { reason: 'early_cancel', now: at }) }
  return applyRelease(sb, trip, outcome, { reason: 'early_cancel', now: at })
}

export async function releaseBackupDriver(sb, { tripId, driverId, now = new Date() } = {}) {
  const trip = await loadTrip(sb, tripId)
  if (!trip) return { ok: false, status: 404, error: 'Trip not found' }
  const queue = queueOf(trip)
  if (!queue) return { ok: false, status: 409, error: 'This ride has no backup driver' }
  const decision = releaseBackupSeat(queue, driverId, now.toISOString())
  if (!decision.ok) return { ok: false, status: 403, error: 'Only the backup driver can leave this seat' }
  const saved = await commitQueue(sb, trip, decision.queue)
  if (!saved) return { ok: false, status: 409, error: 'This trip changed. Refresh and try again.', raced: true }
  await audit(sb, trip.id, 'backup_seat_released', { driverId, at: now.toISOString() })
  return { ok: true, action: 'released', tripId: trip.id, lookingForBackup: true }
}

async function applyRelease(sb, trip, outcome, { reason, now }) {
  const queue = outcome.queue
  const pool = outcome.action === 'pool'
  const patch = pool
    ? {
      status: 'searching',
      driver_id: null,
      pickup_at: null,
      scheduled_for: null,
    }
    : { status: 'scheduled', driver_id: null }
  const saved = await commitQueue(sb, trip, queue, patch, pool ? {
    scheduled_pickup_at: trip.pickup_at,
    kind: 'driver_request',
    match: 'open',
    urgent_backup_release: true,
  } : {})
  if (!saved) return { ok: false, status: 409, raced: true, error: 'This trip changed. Refresh and try again.' }
  const flaked = queue.strikes?.[queue.strikes.length - 1]
  if (flaked?.driverId) await recordStrike(sb, { ...flaked, tripId: trip.id })
  await audit(sb, trip.id, outcome.action === 'promote' ? 'backup_promoted' : 'backup_urgent_pool', {
    reason,
    at: now,
    primaryDriverId: queue.primaryDriverId,
    flakedDriverId: flaked?.driverId || null,
  })
  if (outcome.action === 'promote') {
    await pushToDriver(sb, queue.primaryDriverId, {
      tripId: trip.id,
      kind: 'backup_promoted',
      title: 'You\'re up for this trip',
      body: `${CONFIRM_TRIP_COPY} You have 5 minutes to confirm and start toward pickup.`,
    })
  } else {
    await pushToRider(sb, trip.rider_id, {
      tripId: trip.id,
      title: 'Looking for another driver',
      body: 'Your driver didn\'t confirm. We reopened the ride so someone else can get you there.',
    })
    await notifyAdmin(sb, {
      tripId: trip.id,
      title: URGENT_POOL_LABEL,
      body: `${trip.pickup_label || 'Pickup'} → ${trip.dropoff_label || 'Drop-off'} reopened with no backup.`,
    })
  }
  return { ok: true, action: outcome.action, tripId: trip.id }
}

function movementOf(queue, pickup, presence, telemetry) {
  const current = telemetry || presence?.fix || null
  return driverStartedTowardPickup({
    pickup,
    navigateStartedAt: queue.navigateStartedAt,
    previousFix: queue.lastFix,
    currentFix: current,
  })
}

async function openWindow(sb, trip, queue, bounds, presence, now) {
  const at = now.toISOString()
  const next = {
    ...queue,
    confirmState: 'window_open',
    windowOpensAt: new Date(bounds.opensAt).toISOString(),
    windowClosesAt: new Date(bounds.closesAt).toISOString(),
    windowNotifiedAt: at,
    generation: queue.generation + 1,
    lastFix: presence?.fix || queue.lastFix,
    events: [...queue.events, { kind: 'window_open', at, driverId: queue.primaryDriverId }].slice(-12),
  }
  const saved = await commitQueue(sb, trip, next)
  if (!saved) return { opened: false, raced: true }
  await audit(sb, trip.id, 'backup_window_open', {
    driverId: queue.primaryDriverId,
    opensAt: next.windowOpensAt,
    closesAt: next.windowClosesAt,
  })
  await pushToDriver(sb, queue.primaryDriverId, {
    tripId: trip.id,
    kind: 'confirm_trip',
    title: 'Confirm trip',
    body: CONFIRM_TRIP_COPY,
  })
  return { opened: true }
}

async function markEnroute(sb, trip, queue, now) {
  const at = now.toISOString()
  if (queue.riderNotifiedEnrouteAt) return { enroute: true, idempotent: true }
  const next = {
    ...queue,
    confirmState: 'enroute',
    movementDetectedAt: queue.movementDetectedAt || at,
    riderNotifiedEnrouteAt: at,
    riderNotice: { title: 'Driver on the way', body: RIDER_ENROUTE_COPY, at },
    generation: queue.generation + 1,
    events: [...queue.events, { kind: 'enroute', at, driverId: queue.primaryDriverId }].slice(-12),
  }
  const saved = await commitQueue(sb, trip, next, {
    status: trip.status === 'scheduled' ? 'accepted' : trip.status,
    driver_id: queue.primaryDriverId,
    accepted_at: trip.accepted_at || at,
  })
  if (!saved) return { enroute: false, raced: true }
  await audit(sb, trip.id, 'backup_enroute', { driverId: queue.primaryDriverId, at })
  await pushToRider(sb, trip.rider_id, {
    tripId: trip.id,
    title: 'Driver on the way',
    body: RIDER_ENROUTE_COPY,
  })
  return { enroute: true }
}

function backupAvailability(queue, presence) {
  if (!queue.backupDriverId) return queue
  if (presence && presence.online === false) {
    return { ...queue, backupStoodBy: false, backupOfflineDuringWindow: true }
  }
  return queue
}

function countRelease(summary, released) {
  if (released.raced) summary.raced += 1
  else if (released.action === 'promote') summary.promoted += 1
  else if (released.action === 'pool') summary.pooled += 1
}

function releaseOutcome(queue, reason, now) {
  const at = now.toISOString()
  if (queue.backupDriverId) return { action: 'promote', queue: promoteBackup(queue, { reason, now: at }) }
  return { action: 'pool', queue: handToUrgentPool(queue, { reason, now: at }) }
}

/**
 * Idempotent minute tick. Compare-and-set on the metadata snapshot so two
 * overlapping runs cannot double-promote or double-notify.
 */
export async function runScheduledDispatchTick(sb, { now = new Date(), dryRun = false, limit = 200 } = {}) {
  const listed = await sb.from('trips').select('*').in('status', ACTIVE_STATUSES).not('pickup_at', 'is', null).limit(limit)
  if (listed.error) throw new Error(listed.error.message)
  const summary = {
    scanned: 0,
    opened: 0,
    enroute: 0,
    promoted: 0,
    pooled: 0,
    skipped: 0,
    raced: 0,
  }
  for (const trip of listed.data || []) {
    const queue = queueOf(trip)
    if (!queue?.primaryDriverId) continue
    if (queue.confirmState === 'enroute' || queue.confirmState === 'handed_to_pool') continue
    summary.scanned += 1
    if (dryRun) {
      summary.skipped += 1
      continue
    }
    const pickup = pickupPoint(trip)
    const presence = await driverFix(sb, queue.primaryDriverId)
    const telemetry = await tripFix(sb, trip.id, queue.primaryDriverId)
    let live = queue
    if (queue.backupDriverId && queue.confirmState === 'window_open') {
      live = backupAvailability(live, await driverFix(sb, queue.backupDriverId))
    }
    const moving = movementOf(live, pickup, presence, telemetry)
    const confirmed = Boolean(live.confirmedAt)
    const started = confirmed && (moving || Boolean(live.navigateStartedAt))

    if (live.confirmState === 'window_open') {
      const closes = Date.parse(live.windowClosesAt || '')
      if (started) {
        const marked = await markEnroute(sb, trip, {
          ...live,
          movementDetectedAt: moving ? now.toISOString() : live.movementDetectedAt,
          lastFix: telemetry || presence?.fix || live.lastFix,
        }, now)
        if (marked.raced) summary.raced += 1
        else if (marked.enroute) summary.enroute += 1
        continue
      }
      if (Number.isFinite(closes) && now.getTime() < closes) {
        const fix = telemetry || presence?.fix || null
        const changed = Boolean(fix) && JSON.stringify(fix) !== JSON.stringify(live.lastFix || null)
        const offlineChanged = live.backupOfflineDuringWindow !== queue.backupOfflineDuringWindow
        if (changed || offlineChanged) {
          const saved = await commitQueue(sb, trip, { ...live, lastFix: fix || live.lastFix, generation: live.generation + 1 })
          if (!saved) summary.raced += 1
        }
        continue
      }
      const reason = confirmed ? 'no_movement' : 'no_confirm'
      countRelease(summary, await applyRelease(sb, trip, releaseOutcome(live, reason, now), { reason, now: now.toISOString() }))
      continue
    }

    const driveMs = estimateDriveMs(presence?.fix, pickup)
    const bounds = confirmWindowBounds({ pickupAt: trip.pickup_at, driveMs })
    if (!bounds) continue
    if (now.getTime() < bounds.opensAt) continue
    if (now.getTime() >= bounds.closesAt) {
      countRelease(summary, await applyRelease(sb, trip, releaseOutcome(live, 'no_confirm', now), {
        reason: 'no_confirm',
        now: now.toISOString(),
      }))
      continue
    }
    const opened = await openWindow(sb, trip, live, bounds, presence, now)
    if (opened.raced) summary.raced += 1
    else if (opened.opened) summary.opened += 1
  }
  return summary
}
