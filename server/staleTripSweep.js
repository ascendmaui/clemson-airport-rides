/**
 * Abandoned active trips: no rider heartbeat or location AND no driver
 * heartbeat or location for STALE_TRIP_MS. A rider-app crash with the driver
 * still reporting does not qualify — the passenger may be in the car.
 * Selected trips are canceled, the pre-auth hold is released, and nothing is captured.
 */
import { releaseOpenFareHold } from './fareAuthorization.js'

export const STALE_TRIP_MS = 15 * 60 * 1000
export const STALE_ACTIVE_STATUSES = Object.freeze(['accepted', 'arriving', 'arrived', 'in_progress'])
export const STALE_CANCEL_REASON = 'stale_abandoned'

const FULL_COLUMNS = 'id, rider_id, driver_id, status, accepted_at, created_at, payment_status, metadata, rider_heartbeat_at, driver_heartbeat_at'
const NARROW_COLUMNS = 'id, rider_id, driver_id, status, accepted_at, created_at, payment_status, metadata'

function ms(value) {
  const t = value ? Date.parse(value) : NaN
  return Number.isFinite(t) ? t : null
}

function metaOf(trip) {
  const meta = trip?.metadata
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}
}

export function latestSignalMs(...values) {
  const times = values.map(ms).filter((t) => t != null)
  return times.length ? Math.max(...times) : null
}

function silent(at, nowMs) {
  return at == null || nowMs - at >= STALE_TRIP_MS
}

/**
 * Why this trip must be left alone, or null when both sides have been silent
 * long enough to cancel without charging.
 */
export function staleTripSkip(trip, signals = {}, now = new Date()) {
  if (!trip || !STALE_ACTIVE_STATUSES.includes(trip.status)) return 'not_active'
  const meta = metaOf(trip)
  if (meta.e2e_test === true) return 'e2e_test'
  const nowMs = new Date(now).getTime()
  const anchor = ms(trip.accepted_at) ?? ms(trip.created_at)
  if (anchor == null || nowMs - anchor < STALE_TRIP_MS) return 'too_new'
  const riderAt = latestSignalMs(
    signals.riderHeartbeatAt,
    signals.riderLocationAt,
    trip.rider_heartbeat_at,
    meta.rider_location?.updated_at,
    meta.rider_location?.at,
  )
  const driverAt = latestSignalMs(
    signals.driverHeartbeatAt,
    signals.driverLocationAt,
    signals.driverPresenceAt,
    trip.driver_heartbeat_at,
  )
  if (!silent(riderAt, nowMs) || !silent(driverAt, nowMs)) return 'signal_fresh'
  return null
}

async function listCandidates(sb) {
  const query = (columns) => sb.from('trips').select(columns).in('status', [...STALE_ACTIVE_STATUSES]).limit(40)
  const first = await query(FULL_COLUMNS)
  if (!first?.error) return first.data || []
  if (!/column|schema cache/i.test(first.error.message || '')) {
    throw new Error(first.error.message || 'Could not load active trips')
  }
  const second = await query(NARROW_COLUMNS)
  if (second?.error) throw new Error(second.error.message || 'Could not load active trips')
  return second.data || []
}

async function readMaybe(query) {
  try {
    const result = await query
    if (result?.error) return null
    return result?.data || null
  } catch {
    return null
  }
}

async function signalsFor(sb, trip) {
  const [location, presence] = await Promise.all([
    readMaybe(sb.from('trip_driver_locations').select('updated_at').eq('trip_id', trip.id).maybeSingle()),
    trip.driver_id
      ? readMaybe(sb.from('driver_status').select('location_updated_at').eq('driver_id', trip.driver_id).maybeSingle())
      : null,
  ])
  return {
    driverLocationAt: location?.updated_at || null,
    driverPresenceAt: presence?.location_updated_at || null,
  }
}

export async function sweepStaleTrips(sb, { now = new Date(), dryRun = false, stripe, releaseHold = releaseOpenFareHold } = {}) {
  const at = new Date(now)
  const rows = await listCandidates(sb)
  const result = {
    canceled: 0,
    released: 0,
    failed: 0,
    skipped: 0,
    ids: { canceled: [], released: [], failed: [], skipped: [] },
  }
  const mark = (key, id) => {
    result[key] += 1
    result.ids[key].push(id)
  }
  for (const trip of rows) {
    const signals = await signalsFor(sb, trip)
    if (staleTripSkip(trip, signals, at) || dryRun) {
      mark('skipped', trip.id)
      continue
    }
    try {
      const nowIso = at.toISOString()
      const metadata = {
        ...(trip.metadata || {}),
        cancel_reason: STALE_CANCEL_REASON,
        stale_abandoned: true,
        expired: true,
        stale_abandoned_at: nowIso,
      }
      const updated = await sb.from('trips')
        .update({
          status: 'canceled',
          canceled_at: nowIso,
          payment_status: 'no_charge',
          metadata,
        })
        .eq('id', trip.id)
        .eq('status', trip.status)
        .select('id, rider_id, driver_id, status, payment_status, metadata')
        .maybeSingle()
      if (updated?.error) throw new Error(updated.error.message)
      if (!updated?.data) {
        mark('skipped', trip.id)
        continue
      }
      mark('canceled', trip.id)
      const hold = await releaseHold({ sb, stripe, trip: updated.data, reason: STALE_CANCEL_REASON })
      if (hold?.released) mark('released', trip.id)
      else if (hold?.ok === false) mark('failed', trip.id)
      if (trip.rider_id) {
        try {
          const notice = await sb.from('trip_status_notices').insert({
            trip_id: trip.id,
            kind: STALE_CANCEL_REASON,
            recipient_id: trip.rider_id,
            recipient_role: 'rider',
            driver_id: trip.driver_id || null,
            dedupe_key: `${STALE_CANCEL_REASON}:${trip.id}`,
          })
          if (notice?.error) console.error('[stale-trips] notice', trip.id, notice.error.message)
        } catch (err) {
          console.error('[stale-trips] notice', trip.id, err?.message || err)
        }
      }
    } catch (err) {
      console.error('[stale-trips]', trip.id, err?.message || err)
      mark('failed', trip.id)
    }
  }
  return result
}
