/**
 * Default driver for a new ride that does not already name one.
 * John first, then Kim. Uses the same approval and online checks the
 * driver desk uses before a driver can take a ride. Does not choose among
 * the rest of the fleet.
 */
import { canReceiveRides } from '../shared/driverOnboarding.js'

export const PRIMARY_DEFAULT_DRIVER_EMAIL = 'johnmatveyev@gmail.com'
export const SECONDARY_DEFAULT_DRIVER_EMAIL = 'kimubermaui@gmail.com'

export function normalizeDriverEmail(email) {
  return String(email || '').trim().toLowerCase()
}

/** Gmail whose local part is clearly the Kim Uber Maui account. */
export function isKimMauiGmail(email) {
  const normalized = normalizeDriverEmail(email)
  const at = normalized.lastIndexOf('@')
  if (at <= 0) return false
  const local = normalized.slice(0, at)
  const domain = normalized.slice(at + 1)
  if (domain !== 'gmail.com') return false
  return local.includes('kim') && local.includes('maui')
}

/**
 * Spoken fallback is kimubermaui@gmail.com.
 * If profiles contain exactly one other kim+maui Gmail, that row is the same person.
 * Several different matches do not pick a new person; the spoken address stays the fallback.
 */
export function resolveSecondaryEmail(profileEmails) {
  const matches = []
  const seen = new Set()
  for (const raw of profileEmails || []) {
    const email = normalizeDriverEmail(raw)
    if (!email || seen.has(email) || !isKimMauiGmail(email)) continue
    seen.add(email)
    matches.push(email)
  }
  if (matches.includes(SECONDARY_DEFAULT_DRIVER_EMAIL)) return SECONDARY_DEFAULT_DRIVER_EMAIL
  if (matches.length === 1) return matches[0]
  return SECONDARY_DEFAULT_DRIVER_EMAIL
}

export function defaultDriverOrder(profileEmails) {
  const second = resolveSecondaryEmail(profileEmails)
  if (second === PRIMARY_DEFAULT_DRIVER_EMAIL) return [PRIMARY_DEFAULT_DRIVER_EMAIL]
  return [PRIMARY_DEFAULT_DRIVER_EMAIL, second]
}

/**
 * Unavailable when this driver cannot take the ride.
 * - offline: driver_status.online is not true (missing row counts as offline)
 * - not approved: onboarding_status is not approved (same check as acceptTrip)
 * - availability check failed: the approval or online read returned an error
 * An available driver is not skipped.
 */
export function isDefaultDriverUnavailable({ approved, online, availabilityError }) {
  if (availabilityError) return true
  if (approved !== true) return true
  if (online !== true) return true
  return false
}

export function unavailableReason({ approved, online, availabilityError }) {
  if (availabilityError) return 'availability_check_failed'
  if (approved !== true) return 'not_approved'
  if (online !== true) return 'offline'
  return null
}

function rowsOf(result) {
  if (!result || result.error) return []
  if (Array.isArray(result.data)) return result.data
  return []
}

export async function loadDefaultDriverProfiles(sb) {
  const [primary, kim] = await Promise.all([
    sb.from('profiles').select('id, email').ilike('email', PRIMARY_DEFAULT_DRIVER_EMAIL),
    sb.from('profiles').select('id, email').ilike('email', '%kim%maui%@gmail.com'),
  ])
  if (primary?.error) throw new Error(primary.error.message || 'Could not read default driver profiles')
  if (kim?.error) throw new Error(kim.error.message || 'Could not read Kim driver profile')

  const byEmail = new Map()
  for (const row of [...rowsOf(primary), ...rowsOf(kim)]) {
    const email = normalizeDriverEmail(row?.email)
    const id = row?.id ? String(row.id) : ''
    if (!id || !email) continue
    const john = email === PRIMARY_DEFAULT_DRIVER_EMAIL
    if (!john && !isKimMauiGmail(email)) continue
    if (!byEmail.has(email)) byEmail.set(email, { id, email })
  }
  return [...byEmail.values()]
}

async function readDriverAvailability(sb, driverId) {
  const [appRes, statusRes] = await Promise.all([
    sb.from('driver_applications').select('onboarding_status').eq('profile_id', driverId).maybeSingle(),
    sb.from('driver_status').select('online').eq('driver_id', driverId).maybeSingle(),
  ])
  const availabilityError = appRes?.error?.message || statusRes?.error?.message || null
  return {
    approved: canReceiveRides(appRes?.data?.onboarding_status) === true,
    online: statusRes?.data?.online === true,
    availabilityError,
  }
}

export async function chooseDefaultDriver(sb) {
  const profiles = await loadDefaultDriverProfiles(sb)
  const secondaryEmail = resolveSecondaryEmail(profiles.map((profile) => profile.email))
  const order = defaultDriverOrder(profiles.map((profile) => profile.email))
  const considered = []

  for (const email of order) {
    const profile = profiles.find((row) => row.email === email) || null
    if (!profile) {
      considered.push({
        email,
        driverId: null,
        profileExists: false,
        approved: false,
        online: false,
        unavailable: true,
        reason: 'no_profile',
      })
      continue
    }
    const availability = await readDriverAvailability(sb, profile.id)
    const unavailable = isDefaultDriverUnavailable(availability)
    considered.push({
      email,
      driverId: profile.id,
      profileExists: true,
      approved: availability.approved,
      online: availability.online,
      unavailable,
      reason: unavailable ? unavailableReason(availability) : 'available',
    })
    if (!unavailable) {
      return {
        driverId: profile.id,
        email,
        profileExists: true,
        approved: true,
        online: true,
        secondaryEmail,
        considered,
      }
    }
  }

  return {
    driverId: null,
    email: null,
    profileExists: false,
    approved: false,
    online: false,
    secondaryEmail,
    considered,
  }
}

/** Pin the ride the same way a preferred-driver request does. Scheduled stays scheduled. */
export function withDefaultDriver(row, choice) {
  if (!choice?.driverId) return row
  const status = row?.status === 'searching' ? 'requested' : row?.status
  return {
    ...row,
    driver_id: choice.driverId,
    status,
    metadata: {
      ...(row?.metadata || {}),
      default_assignment: true,
      default_driver_email: choice.email,
      preferred_driver_id: choice.driverId,
      match: 'default',
    },
  }
}

/**
 * Stamp a new ride that does not already have a driver.
 * Lookup failures leave the row unchanged so booking still completes.
 */
export async function prepareDefaultDriverRow(sb, row) {
  if (row?.driver_id) return { row, choice: null, skipped: 'already_assigned' }
  try {
    const choice = await chooseDefaultDriver(sb)
    if (!choice?.driverId) return { row, choice }
    return { row: withDefaultDriver(row, choice), choice }
  } catch (err) {
    return { row, choice: null, error: err?.message || 'default driver lookup failed' }
  }
}

export function assignmentCopy(trip) {
  const pickup = trip?.pickup_label || 'Pickup'
  const dropoff = trip?.dropoff_label || 'Drop-off'
  return {
    title: 'You were assigned to a ride',
    body: `${pickup} → ${dropoff}. This ride is assigned to you.`,
  }
}
