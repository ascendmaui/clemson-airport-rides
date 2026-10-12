import { releaseOpenFareHold } from './fareAuthorization.js'
import { readBackupQueue } from '../shared/backupDriverQueue.js'

/** An on-demand ride still searching this long after it was requested auto-cancels. */
export const SEARCH_TIMEOUT_MS = 15 * 60 * 1000
export const SEARCH_TIMEOUT_REASON = 'search_timeout'
export const SEARCH_TIMEOUT_NOTICE = 'search_timeout'

function ms(value) {
  const t = value ? Date.parse(value) : NaN
  return Number.isFinite(t) ? t : null
}

/**
 * When this ride started (or restarted) looking for a driver. A scheduled ride
 * released to the live pool counts from its release or pickup time, never from
 * when it was booked.
 */
export function searchStartedMs(trip) {
  const meta = trip?.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
  const times = [
    trip?.created_at, trip?.requested_at, trip?.pickup_at, trip?.scheduled_for,
    meta.scheduled_pickup_at, meta.scheduled_released_at,
  ].map(ms).filter((t) => t != null)
  return times.length ? Math.max(...times) : null
}

/** Why a searching trip is not timed out yet, or null when it should cancel. */
export function searchTimeoutSkip(trip, now = new Date()) {
  if (!trip || trip.status !== 'searching' || trip.driver_id) return 'not_searching'
  const meta = trip.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
  if (meta.e2e_test === true) return 'e2e_test'
  const nowMs = new Date(now).getTime()
  const due = ms(trip.pickup_at) ?? ms(trip.scheduled_for)
  if (due != null && due > nowMs) return 'scheduled_not_due'
  // Backup-queue rides are re-dispatched by the backup tick (promote or urgent pool); leave them to it.
  const queue = readBackupQueue(trip)
  if (queue && queue.confirmState !== 'released') return 'backup_queue'
  const started = searchStartedMs(trip)
  if (started == null || nowMs - started < SEARCH_TIMEOUT_MS) return 'not_due'
  return null
}

export const SEARCH_TIMEOUT_COLUMNS = 'id, rider_id, driver_id, status, created_at, requested_at, pickup_at, scheduled_for, payment_status, metadata'

export async function sweepSearchTimeouts(sb, { now = new Date(), dryRun = false, stripe, releaseHold = releaseOpenFareHold } = {}) {
  const at = new Date(now)
  const cutoff = new Date(at.getTime() - SEARCH_TIMEOUT_MS).toISOString()
  const { data, error } = await sb.from('trips')
    .select(SEARCH_TIMEOUT_COLUMNS)
    .eq('status', 'searching')
    .is('driver_id', null)
    .lte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(25)
  if (error) throw new Error(error.message || 'Could not load searching trips')
  const result = { canceled: 0, released: 0, failed: 0, skipped: 0, ids: { canceled: [], released: [], failed: [], skipped: [] } }
  const mark = (key, id) => { result[key] += 1; result.ids[key].push(id) }
  for (const trip of data || []) {
    if (searchTimeoutSkip(trip, at) || dryRun) { mark('skipped', trip.id); continue }
    try {
      const nowIso = at.toISOString()
      const metadata = { ...(trip.metadata || {}), cancel_reason: SEARCH_TIMEOUT_REASON, search_timeout_at: nowIso }
      // Compare-and-set: an accept, rider cancel, or another sweep wins safely.
      const updated = await sb.from('trips')
        .update({ status: 'canceled', canceled_at: nowIso, offer_expires_at: null, payment_status: 'no_charge', metadata })
        .eq('id', trip.id).eq('status', 'searching').is('driver_id', null)
        .select(SEARCH_TIMEOUT_COLUMNS).maybeSingle()
      if (updated.error) throw new Error(updated.error.message)
      if (!updated.data) { mark('skipped', trip.id); continue }
      mark('canceled', trip.id)
      const hold = await releaseHold({ sb, stripe, trip: updated.data, reason: SEARCH_TIMEOUT_REASON })
      // A failed release stays requires_capture on a canceled trip; the canceled-holds sweep retries it.
      if (hold?.released) mark('released', trip.id)
      else if (hold?.ok === false) mark('failed', trip.id)
      if (trip.rider_id) {
        const notice = await sb.from('trip_status_notices').upsert({
          trip_id: trip.id,
          kind: SEARCH_TIMEOUT_NOTICE,
          recipient_id: trip.rider_id,
          recipient_role: 'rider',
          driver_id: null,
          dedupe_key: `${SEARCH_TIMEOUT_NOTICE}:${trip.id}`,
        }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
        if (notice?.error) console.error('[search-timeout] notice', trip.id, notice.error.message)
      }
    } catch (err) {
      console.error('[search-timeout]', trip.id, err?.message || err)
      mark('failed', trip.id)
    }
  }
  return result
}
