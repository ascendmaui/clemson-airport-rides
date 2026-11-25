/**
 * Columns RideToastWatcher reads. Keep these to columns that exist in prod:
 * trips has no updated_at, and ride_bills has no status or amount_cents
 * (a bill is charged when charged_at is set; the participant's share is
 * split_cents, falling back to total_fare_cents).
 */
export const TOAST_TRIP_COLUMNS = 'id, status, pickup_label, dropoff_label, rider_id, driver_id, pickup_at, scheduled_for, metadata'
export const TOAST_TRIP_POLL_COLUMNS = 'id, status, pickup_label, dropoff_label, pickup_at, scheduled_for, metadata'
export const TOAST_BILL_COLUMNS = 'id, charged_at, split_cents, total_fare_cents, created_at'

/** Toast state for a ride_bills row: 'charged' once charged_at is set, else 'pending'. */
export function billToastStatus(row) {
  return row?.charged_at ? 'charged' : 'pending'
}

export function billToastCents(row) {
  const split = Number(row?.split_cents)
  if (Number.isFinite(split) && split > 0) return split
  const total = Number(row?.total_fare_cents)
  return Number.isFinite(total) && total > 0 ? total : 0
}
