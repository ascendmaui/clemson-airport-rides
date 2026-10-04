/** House dispatch order. Emails stay on the server; riders only see a rank. */
export const DEFAULT_DRIVER_EMAILS = [
  'johnmatveyev@gmail.com',
  'kimubermaui@gmail.com',
]

export const EVERYONE_ELSE_RANK = DEFAULT_DRIVER_EMAILS.length

export function normalizeDriverEmail(email) {
  return String(email || '').trim().toLowerCase()
}

/** 0 = first house driver, 1 = second, then everyone else. */
export function defaultDriverRank(email) {
  const index = DEFAULT_DRIVER_EMAILS.indexOf(normalizeDriverEmail(email))
  return index === -1 ? EVERYONE_ELSE_RANK : index
}

export function driverDispatchRank(driver) {
  const explicit = driver?.dispatchRank ?? driver?.dispatch_rank
  if (explicit != null && explicit !== '' && Number.isFinite(Number(explicit))) {
    return Number(explicit)
  }
  return defaultDriverRank(driver?.email)
}

/**
 * First online driver in house order, then everyone else by id.
 * Offline rows are not assigned.
 */
export function pickAutoAssignDriver(candidates) {
  const online = (Array.isArray(candidates) ? candidates : []).filter((row) => row && row.online && row.id)
  online.sort((a, b) => {
    const rank = driverDispatchRank(a) - driverDispatchRank(b)
    if (rank !== 0) return rank
    return String(a.id).localeCompare(String(b.id))
  })
  return online[0] || null
}
