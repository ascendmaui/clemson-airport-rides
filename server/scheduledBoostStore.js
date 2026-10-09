/**
 * Persist a scheduled boost on the trip row and in metadata.
 * The column is optional until 20261007150000_trip_boost_cents.sql is applied.
 * Metadata is enough for staging, which shares the production database.
 */
import { boostColumnMissing, boostMetadata, clampBoostCents } from '../shared/scheduledBoost.js'

const TRIP_SELECT = 'id, status, pickup_at, pickup_label, dropoff_label, fare_cents, deposit_cents, metadata, rider_id, driver_id'

export async function insertTripRow(sb, row) {
  const inserted = await sb.from('trips').insert(row).select(TRIP_SELECT).single()
  if (!inserted.error || !Object.prototype.hasOwnProperty.call(row, 'boost_cents') || !boostColumnMissing(inserted.error)) {
    return inserted
  }
  const { boost_cents: _ignored, ...rest } = row
  return sb.from('trips').insert(rest).select(TRIP_SELECT).single()
}

export async function loadTripForBoost(sb, tripId) {
  const rich = await sb.from('trips')
    .select('id, rider_id, driver_id, status, fare_cents, metadata, boost_cents')
    .eq('id', tripId)
    .maybeSingle()
  if (!rich.error || !boostColumnMissing(rich.error)) return rich
  return sb.from('trips')
    .select('id, rider_id, driver_id, status, fare_cents, metadata')
    .eq('id', tripId)
    .maybeSingle()
}

export async function updateTripBoost(sb, tripId, { boostCents, metadata, match }) {
  const boost = clampBoostCents(boostCents)
  const nextMetadata = { ...(metadata || {}), ...boostMetadata(boost) }
  const patch = { boost_cents: boost, metadata: nextMetadata }
  let query = sb.from('trips').update(patch).eq('id', tripId)
  if (match?.riderId) query = query.eq('rider_id', match.riderId)
  if (match?.statuses) query = query.in('status', match.statuses)
  if (match?.unassigned) query = query.is('driver_id', null)
  const first = await query.select(TRIP_SELECT).maybeSingle()
  if (!first.error || !boostColumnMissing(first.error)) return { ...first, metadata: nextMetadata }
  let retry = sb.from('trips').update({ metadata: nextMetadata }).eq('id', tripId)
  if (match?.riderId) retry = retry.eq('rider_id', match.riderId)
  if (match?.statuses) retry = retry.in('status', match.statuses)
  if (match?.unassigned) retry = retry.is('driver_id', null)
  const second = await retry.select(TRIP_SELECT).maybeSingle()
  return { ...second, metadata: nextMetadata }
}
