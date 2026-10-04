/**
 * Default dispatch order for the website.
 * Emails stay on the server. The picker receives only a rank number.
 */

export const DEFAULT_DRIVER_EMAILS = [
  'johnmatveyev@gmail.com',
  'kimubermaui@gmail.com',
]

/** 0 is first. Everyone outside the list shares the last rank. */
export function defaultDriverRank(email) {
  const value = String(email || '').trim().toLowerCase()
  const index = DEFAULT_DRIVER_EMAILS.indexOf(value)
  return index === -1 ? DEFAULT_DRIVER_EMAILS.length : index
}

export function dispatchRankOf(driver) {
  if (Number.isInteger(driver?.dispatchRank)) return driver.dispatchRank
  return defaultDriverRank(driver?.email)
}

export function sortByDefaultDriverOrder(drivers) {
  return [...(drivers || [])].sort((a, b) => {
    const rank = dispatchRankOf(a) - dispatchRankOf(b)
    if (rank !== 0) return rank
    return String(a?.id || '').localeCompare(String(b?.id || ''))
  })
}

/**
 * A targeted offer (rider pick or auto-assign) is visible only to that driver.
 * Rows with no offer_driver_id stay in the open pool.
 */
export function offerVisibleToDriver(trip, driverId) {
  if (!trip || !driverId) return false
  if (trip.rider_id && trip.rider_id === driverId) return false
  const meta = trip.metadata && typeof trip.metadata === 'object' && !Array.isArray(trip.metadata)
    ? trip.metadata
    : {}
  if (Array.isArray(meta.offer_passed_driver_ids) && meta.offer_passed_driver_ids.includes(driverId)) return false
  const target = typeof meta.offer_driver_id === 'string' ? meta.offer_driver_id : ''
  if (trip.driver_id && trip.driver_id !== driverId) return false
  if (target) return target === driverId
  return !trip.driver_id || trip.driver_id === driverId
}

/** Filter before LIMIT so other drivers' targeted offers cannot crowd out the pool. */
export function visibleOfferQuery(query, driverId) {
  return query.is('driver_id', null).or(
    `metadata->>offer_driver_id.is.null,metadata->>offer_driver_id.eq."",metadata->>offer_driver_id.eq.${JSON.stringify(driverId)}`,
  )
}

/** Compare the dispatch snapshot as well as status when mutating an offer. */
export function unchangedOfferQuery(query, trip) {
  return trip.metadata == null
    ? query.is('metadata', null)
    : query.eq('metadata', JSON.stringify(trip.metadata))
}
